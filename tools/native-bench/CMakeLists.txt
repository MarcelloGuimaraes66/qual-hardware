cmake_minimum_required(VERSION 3.20)
project(qual_hardware_native_bench LANGUAGES CXX)

add_executable(qual-hardware-native-bench main.cpp)
target_compile_features(qual-hardware-native-bench PRIVATE cxx_std_20)
target_compile_definitions(qual-hardware-native-bench PRIVATE UNICODE _UNICODE NOMINMAX)

if(MSVC)
  target_compile_options(qual-hardware-native-bench PRIVATE /W4 /permissive- /EHsc)
  target_link_libraries(qual-hardware-native-bench PRIVATE d3d12 dxgi mfplat mfuuid ole32)
else()
  target_compile_options(qual-hardware-native-bench PRIVATE -Wall -Wextra -Wpedantic)
  target_link_libraries(qual-hardware-native-bench PRIVATE ${CMAKE_DL_LIBS})
endif()
