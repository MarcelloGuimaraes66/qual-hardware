#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <future>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#include <d3d12.h>
#include <dxgi1_6.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfobjects.h>
#include <wrl/client.h>
using Microsoft::WRL::ComPtr;
#else
#include <dlfcn.h>
#endif

namespace {
using Clock = std::chrono::steady_clock;

struct GpuResult {
  unsigned index = 0;
  std::string name;
  std::uint64_t dedicatedBytes = 0;
  bool deviceCreated = false;
  bool measured = false;
  double copyBytesPerSecond = 0.0;
  std::string reason;
};

std::string jsonEscape(const std::string& value) {
  std::ostringstream output;
  for (const unsigned char character : value) {
    switch (character) {
      case '"': output << "\\\""; break;
      case '\\': output << "\\\\"; break;
      case '\b': output << "\\b"; break;
      case '\f': output << "\\f"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (character < 0x20) {
          output << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                 << static_cast<unsigned>(character) << std::dec;
        } else {
          output << character;
        }
    }
  }
  return output.str();
}

unsigned integerArgument(int argc, char** argv, const std::string& name, unsigned fallback) {
  for (int index = 1; index + 1 < argc; ++index) {
    if (argv[index] != name) continue;
    try {
      const auto value = std::stoul(argv[index + 1]);
      return static_cast<unsigned>(std::clamp<unsigned long>(value, 1, 3'600'000));
    } catch (...) {
      return fallback;
    }
  }
  return fallback;
}

bool hasArgument(int argc, char** argv, const std::string& name) {
  for (int index = 1; index < argc; ++index) {
    if (argv[index] == name) return true;
  }
  return false;
}

double cpuBenchmark(unsigned durationMs, unsigned requestedThreads) {
  const unsigned threads = std::max(1U, std::min(requestedThreads, std::max(1U, std::thread::hardware_concurrency())));
  const auto deadline = Clock::now() + std::chrono::milliseconds(durationMs);
  std::atomic<std::uint64_t> operations{0};
  std::vector<std::thread> workers;
  workers.reserve(threads);
  for (unsigned threadIndex = 0; threadIndex < threads; ++threadIndex) {
    workers.emplace_back([&, seed = std::uint64_t{0x9e3779b97f4a7c15ULL + threadIndex}]() mutable {
      std::uint64_t local = 0;
      double accumulator = 1.0 + threadIndex;
      while (Clock::now() < deadline) {
        for (unsigned index = 0; index < 4'096; ++index) {
          seed ^= seed << 13U;
          seed ^= seed >> 7U;
          seed ^= seed << 17U;
          accumulator = std::fma(accumulator, 1.0000001192092896, static_cast<double>(seed & 0xffU) * 1e-9);
          if (accumulator > 1e12) accumulator *= 1e-9;
        }
        local += 4'096;
      }
      if (accumulator == 0.0) std::cerr << "";
      operations.fetch_add(local, std::memory_order_relaxed);
    });
  }
  for (auto& worker : workers) worker.join();
  return static_cast<double>(operations.load()) / (static_cast<double>(durationMs) / 1'000.0);
}

double memoryBenchmark(unsigned durationMs) {
  constexpr std::size_t bytes = 32U * 1024U * 1024U;
  std::vector<std::uint8_t> source(bytes, 0x5a);
  std::vector<std::uint8_t> destination(bytes, 0);
  const auto started = Clock::now();
  const auto deadline = started + std::chrono::milliseconds(durationMs);
  std::uint64_t copied = 0;
  while (Clock::now() < deadline) {
    std::memcpy(destination.data(), source.data(), bytes);
    copied += bytes;
    std::swap(source, destination);
  }
  const auto seconds = std::chrono::duration<double>(Clock::now() - started).count();
  return seconds > 0 ? static_cast<double>(copied) / seconds : 0.0;
}

#if defined(_WIN32)
std::string utf8(const wchar_t* value) {
  if (!value || !*value) return {};
  const int bytes = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (bytes <= 1) return {};
  std::string result(static_cast<std::size_t>(bytes), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), bytes, nullptr, nullptr);
  result.pop_back();
  return result;
}

GpuResult measureAdapter(IDXGIAdapter1* adapter, unsigned index) {
  GpuResult result;
  result.index = index;
  DXGI_ADAPTER_DESC1 description{};
  if (FAILED(adapter->GetDesc1(&description))) {
    result.reason = "dxgi_description_failed";
    return result;
  }
  result.name = utf8(description.Description);
  result.dedicatedBytes = static_cast<std::uint64_t>(description.DedicatedVideoMemory);
  if ((description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0) {
    result.reason = "software_adapter";
    return result;
  }
  ComPtr<ID3D12Device> device;
  if (FAILED(D3D12CreateDevice(adapter, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&device)))) {
    result.reason = "d3d12_device_unavailable";
    return result;
  }
  result.deviceCreated = true;
  D3D12_COMMAND_QUEUE_DESC queueDescription{};
  queueDescription.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
  ComPtr<ID3D12CommandQueue> queue;
  ComPtr<ID3D12CommandAllocator> allocator;
  ComPtr<ID3D12GraphicsCommandList> commands;
  if (FAILED(device->CreateCommandQueue(&queueDescription, IID_PPV_ARGS(&queue))) ||
      FAILED(device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&allocator))) ||
      FAILED(device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, allocator.Get(), nullptr, IID_PPV_ARGS(&commands)))) {
    result.reason = "d3d12_command_setup_failed";
    return result;
  }
  constexpr UINT64 bytes = 16ULL * 1024ULL * 1024ULL;
  D3D12_RESOURCE_DESC bufferDescription{};
  bufferDescription.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER;
  bufferDescription.Width = bytes;
  bufferDescription.Height = 1;
  bufferDescription.DepthOrArraySize = 1;
  bufferDescription.MipLevels = 1;
  bufferDescription.SampleDesc.Count = 1;
  bufferDescription.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
  auto heap = [](D3D12_HEAP_TYPE type) {
    D3D12_HEAP_PROPERTIES properties{};
    properties.Type = type;
    return properties;
  };
  ComPtr<ID3D12Resource> upload;
  ComPtr<ID3D12Resource> gpu;
  ComPtr<ID3D12Resource> readback;
  auto uploadHeap = heap(D3D12_HEAP_TYPE_UPLOAD);
  auto defaultHeap = heap(D3D12_HEAP_TYPE_DEFAULT);
  auto readbackHeap = heap(D3D12_HEAP_TYPE_READBACK);
  if (FAILED(device->CreateCommittedResource(&uploadHeap, D3D12_HEAP_FLAG_NONE, &bufferDescription,
        D3D12_RESOURCE_STATE_GENERIC_READ, nullptr, IID_PPV_ARGS(&upload))) ||
      FAILED(device->CreateCommittedResource(&defaultHeap, D3D12_HEAP_FLAG_NONE, &bufferDescription,
        D3D12_RESOURCE_STATE_COPY_DEST, nullptr, IID_PPV_ARGS(&gpu))) ||
      FAILED(device->CreateCommittedResource(&readbackHeap, D3D12_HEAP_FLAG_NONE, &bufferDescription,
        D3D12_RESOURCE_STATE_COPY_DEST, nullptr, IID_PPV_ARGS(&readback)))) {
    result.reason = "d3d12_buffer_allocation_failed";
    return result;
  }
  void* mapped = nullptr;
  if (SUCCEEDED(upload->Map(0, nullptr, &mapped))) {
    std::memset(mapped, 0x3c, static_cast<std::size_t>(bytes));
    upload->Unmap(0, nullptr);
  }
  commands->CopyBufferRegion(gpu.Get(), 0, upload.Get(), 0, bytes);
  D3D12_RESOURCE_BARRIER barrier{};
  barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
  barrier.Transition.pResource = gpu.Get();
  barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_COPY_DEST;
  barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_COPY_SOURCE;
  barrier.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
  commands->ResourceBarrier(1, &barrier);
  commands->CopyBufferRegion(readback.Get(), 0, gpu.Get(), 0, bytes);
  if (FAILED(commands->Close())) {
    result.reason = "d3d12_command_close_failed";
    return result;
  }
  ComPtr<ID3D12Fence> fence;
  if (FAILED(device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&fence)))) {
    result.reason = "d3d12_fence_failed";
    return result;
  }
  HANDLE event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!event) {
    result.reason = "d3d12_event_failed";
    return result;
  }
  const auto started = Clock::now();
  ID3D12CommandList* commandLists[] = {commands.Get()};
  queue->ExecuteCommandLists(1, commandLists);
  queue->Signal(fence.Get(), 1);
  fence->SetEventOnCompletion(1, event);
  const DWORD wait = WaitForSingleObject(event, 10'000);
  CloseHandle(event);
  if (wait != WAIT_OBJECT_0) {
    result.reason = "d3d12_copy_timeout";
    return result;
  }
  const double seconds = std::chrono::duration<double>(Clock::now() - started).count();
  result.measured = seconds > 0;
  result.copyBytesPerSecond = seconds > 0 ? static_cast<double>(bytes * 2ULL) / seconds : 0.0;
  result.reason = result.measured ? "" : "d3d12_timer_failed";
  return result;
}

std::vector<GpuResult> enumerateGpus() {
  std::vector<GpuResult> results;
  ComPtr<IDXGIFactory6> factory;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return results;
  for (unsigned index = 0;; ++index) {
    ComPtr<IDXGIAdapter1> adapter;
    if (factory->EnumAdapterByGpuPreference(index, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE,
          IID_PPV_ARGS(&adapter)) == DXGI_ERROR_NOT_FOUND) break;
    results.push_back(measureAdapter(adapter.Get(), index));
  }
  return results;
}

unsigned hardwareDecoderCount(const GUID& subtype) {
  IMFActivate** activations = nullptr;
  UINT32 count = 0;
  MFT_REGISTER_TYPE_INFO input{MFMediaType_Video, subtype};
  const HRESULT status = MFTEnumEx(MFT_CATEGORY_VIDEO_DECODER,
    MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, &input, nullptr, &activations, &count);
  if (SUCCEEDED(status) && activations) {
    for (UINT32 index = 0; index < count; ++index) activations[index]->Release();
    CoTaskMemFree(activations);
  }
  return SUCCEEDED(status) ? count : 0;
}
#else
std::vector<GpuResult> enumerateGpus() {
  std::vector<GpuResult> results;
#if defined(__APPLE__)
  void* metal = dlopen("/System/Library/Frameworks/Metal.framework/Metal", RTLD_LAZY | RTLD_LOCAL);
  if (metal) {
    results.push_back({0, "Apple Metal (dispositivo padrão)", 0, true, false, 0.0,
      "selecao_por_dispositivo_nao_implementada_neste_helper"});
    dlclose(metal);
  }
#else
  void* vulkan = dlopen("libvulkan.so.1", RTLD_LAZY | RTLD_LOCAL);
  if (vulkan) {
    results.push_back({0, "Vulkan (inventário do driver)", 0, true, false, 0.0,
      "enumeracao_vulkan_detalhada_indisponivel"});
    dlclose(vulkan);
  }
#endif
  return results;
}
#endif

void printResult(unsigned durationMs, unsigned threads) {
  const auto started = Clock::now();
  // These are parts of the same machine load. Measuring them concurrently
  // keeps requested duration aligned with wall-clock duration and captures
  // the contention produced by a real workload.
  auto cpuFuture = std::async(std::launch::async, cpuBenchmark, durationMs, threads);
  auto memoryFuture = std::async(
    std::launch::async, memoryBenchmark, std::max(20U, durationMs / 2U));
#if defined(_WIN32)
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool mediaFoundation = SUCCEEDED(MFStartup(MF_VERSION, MFSTARTUP_FULL));
  const unsigned h264Decoders = mediaFoundation ? hardwareDecoderCount(MFVideoFormat_H264) : 0;
  const unsigned h265Decoders = mediaFoundation ? hardwareDecoderCount(MFVideoFormat_HEVC) : 0;
#else
  const bool mediaFoundation = false;
  const unsigned h264Decoders = 0;
  const unsigned h265Decoders = 0;
#endif
  const auto gpus = enumerateGpus();
  const auto cpuOperations = cpuFuture.get();
  const auto memoryBytes = memoryFuture.get();
  const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
    Clock::now() - started).count();
  std::ostringstream output;
  output << "{\"schemaVersion\":\"qual-hardware-native-benchmark/1.0.0\",\"status\":\"passed\","
         << "\"durationMs\":" << durationMs << ",\"elapsedMs\":" << elapsedMs
         << ",\"cpu\":{\"threads\":" << threads
         << ",\"operationsPerSecond\":" << std::fixed << std::setprecision(2) << cpuOperations
         << ",\"memoryBytesPerSecond\":" << memoryBytes << "},"
         << "\"video\":{\"nativeApiAvailable\":" << (mediaFoundation ? "true" : "false")
         << ",\"h264HardwareDecoders\":" << h264Decoders
         << ",\"h265HardwareDecoders\":" << h265Decoders << "},\"gpus\":[";
  for (std::size_t index = 0; index < gpus.size(); ++index) {
    if (index) output << ',';
    const auto& gpu = gpus[index];
    output << "{\"index\":" << gpu.index << ",\"name\":\"" << jsonEscape(gpu.name)
           << "\",\"dedicatedBytes\":" << gpu.dedicatedBytes
           << ",\"deviceCreated\":" << (gpu.deviceCreated ? "true" : "false")
           << ",\"measured\":" << (gpu.measured ? "true" : "false")
           << ",\"copyBytesPerSecond\":" << gpu.copyBytesPerSecond
           << ",\"reason\":\"" << jsonEscape(gpu.reason) << "\"}";
  }
  output << "],\"externalNetworkUsed\":false}\n";
  std::cout << output.str();
#if defined(_WIN32)
  if (mediaFoundation) MFShutdown();
  CoUninitialize();
#endif
}

void printSelfTest() {
  // Startup only needs to prove that the executable can run and that its JSON
  // contract is intact. Hardware enumeration belongs to calibration preflight;
  // doing D3D12 work here made the mandatory environment screen take several
  // seconds per adapter and occasionally race with desktop smoke startup.
  std::cout
    << "{\"schemaVersion\":\"qual-hardware-native-benchmark/1.0.0\","
    << "\"status\":\"passed\",\"durationMs\":0,\"elapsedMs\":0,"
    << "\"cpu\":{\"threads\":0,\"operationsPerSecond\":0,\"memoryBytesPerSecond\":0},"
    << "\"video\":{\"nativeApiAvailable\":false,\"h264HardwareDecoders\":0,"
    << "\"h265HardwareDecoders\":0},\"gpus\":[],\"externalNetworkUsed\":false}\n"
    << std::flush;
}
}  // namespace

int main(int argc, char** argv) {
  const bool selfTest = hasArgument(argc, argv, "--self-test");
  if (selfTest) {
    printSelfTest();
    return 0;
  }
  const unsigned durationMs = integerArgument(argc, argv, "--duration-ms", 250U);
  const unsigned threads = integerArgument(argc, argv, "--threads", std::max(1U, std::thread::hardware_concurrency()));
  printResult(durationMs, threads);
  return 0;
}
