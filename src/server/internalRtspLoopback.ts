import { createServer, type Server, type Socket } from "node:net";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { randomBytes } from "node:crypto";

interface InternalRtspTrack {
  path: string;
  codec: "h264" | "h265";
}

interface BoundTrack extends InternalRtspTrack {
  udp: UdpSocket;
  udpPort: number;
  subscribers: Set<Socket>;
}

export interface InternalRtspLoopback {
  port: number;
  publisherTargets: Array<{ path: string; udpPort: number }>;
  close(): Promise<void>;
}

function rtspResponse(cseq: string, status: string, headers: Record<string, string> = {}, body = ""): string {
  const bodyBytes = Buffer.byteLength(body, "utf8");
  return [
    `RTSP/1.0 ${status}`,
    `CSeq: ${cseq}`,
    "Server: Qual-Hardware-Internal-Loopback/1.0",
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    ...(body ? [`Content-Length: ${bodyBytes}`] : []),
    "",
    body,
  ].join("\r\n");
}

function requestPath(candidate: string): string {
  try {
    const path = new URL(candidate).pathname.replace(/^\/+|\/+$/g, "");
    return path;
  } catch {
    return candidate.replace(/^\/+|\/+$/g, "");
  }
}

function trackSdp(track: BoundTrack, port: number): string {
  const encoding = track.codec === "h265" ? "H265" : "H264";
  return [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=Qual Hardware synthetic loopback",
    "c=IN IP4 127.0.0.1",
    "t=0 0",
    "a=control:*",
    "m=video 0 RTP/AVP 96",
    `a=rtpmap:96 ${encoding}/90000`,
    `a=control:rtsp://127.0.0.1:${port}/${track.path}/trackID=0`,
    "",
  ].join("\r\n");
}

function closeTcpServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function closeUdpSocket(socket: UdpSocket): Promise<void> {
  return new Promise((resolveClose) => socket.close(() => resolveClose()));
}

export async function createInternalRtspLoopback(tracks: InternalRtspTrack[]): Promise<InternalRtspLoopback> {
  if (tracks.length === 0) throw new Error("internal_rtsp_track_required");
  const uniquePaths = new Set<string>();
  const boundTracks: BoundTrack[] = [];
  for (const input of tracks) {
    const path = input.path.replace(/^\/+|\/+$/g, "");
    if (!path || uniquePaths.has(path)) throw new Error("internal_rtsp_track_path_invalid");
    uniquePaths.add(path);
    const udp = createSocket("udp4");
    await new Promise<void>((resolveBind, rejectBind) => {
      udp.once("error", rejectBind);
      udp.bind(0, "127.0.0.1", () => {
        udp.off("error", rejectBind);
        resolveBind();
      });
    });
    const address = udp.address();
    boundTracks.push({ ...input, path, udp, udpPort: address.port, subscribers: new Set() });
  }

  const sessions = new Map<Socket, { track: BoundTrack | null; playing: boolean; channel: number }>();
  const server = createServer((socket) => {
    socket.setNoDelay(true);
    sessions.set(socket, { track: null, playing: false, channel: 0 });
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (true) {
        const headerEnd = buffered.indexOf("\r\n\r\n");
        if (headerEnd < 0) break;
        const header = buffered.subarray(0, headerEnd).toString("utf8");
        buffered = buffered.subarray(headerEnd + 4);
        const lines = header.split("\r\n");
        const [method = "", target = ""] = (lines[0] ?? "").split(/\s+/);
        const headers = Object.fromEntries(lines.slice(1).flatMap((line) => {
          const separator = line.indexOf(":");
          return separator > 0 ? [[line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()]] : [];
        }));
        const cseq = headers.cseq ?? "0";
        const normalizedPath = requestPath(target).replace(/\/trackID=0$/i, "");
        const track = boundTracks.find((item) => item.path === normalizedPath) ?? null;
        const session = sessions.get(socket)!;
        if (method === "OPTIONS") {
          socket.write(rtspResponse(cseq, "200 OK", {
            Public: "OPTIONS, DESCRIBE, SETUP, PLAY, GET_PARAMETER, TEARDOWN",
          }));
        } else if (method === "DESCRIBE" && track) {
          const sdp = trackSdp(track, (server.address() as { port: number }).port);
          socket.write(rtspResponse(cseq, "200 OK", {
            "Content-Type": "application/sdp",
            "Content-Base": `rtsp://127.0.0.1:${(server.address() as { port: number }).port}/${track.path}/`,
          }, sdp));
        } else if (method === "SETUP" && track) {
          const channelMatch = /interleaved=(\d+)-(\d+)/i.exec(headers.transport ?? "");
          session.track = track;
          session.channel = Number(channelMatch?.[1] ?? 0);
          socket.write(rtspResponse(cseq, "200 OK", {
            Transport: `RTP/AVP/TCP;unicast;interleaved=${session.channel}-${session.channel + 1}`,
            Session: randomBytes(8).toString("hex"),
          }));
        } else if (method === "PLAY" && session.track) {
          session.playing = true;
          session.track.subscribers.add(socket);
          socket.write(rtspResponse(cseq, "200 OK", { Session: headers.session ?? randomBytes(8).toString("hex") }));
        } else if (method === "GET_PARAMETER") {
          socket.write(rtspResponse(cseq, "200 OK", { Session: headers.session ?? "" }));
        } else if (method === "TEARDOWN") {
          socket.write(rtspResponse(cseq, "200 OK", { Session: headers.session ?? "" }));
          socket.end();
        } else {
          socket.write(rtspResponse(cseq, track ? "455 Method Not Valid in This State" : "404 Not Found"));
        }
      }
    });
    const cleanup = (): void => {
      const state = sessions.get(socket);
      state?.track?.subscribers.delete(socket);
      sessions.delete(socket);
    };
    socket.once("close", cleanup);
    socket.once("error", cleanup);
  });

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    for (const track of boundTracks) {
      track.udp.on("message", (packet) => {
        for (const subscriber of [...track.subscribers]) {
          const state = sessions.get(subscriber);
          if (!state?.playing || subscriber.destroyed || !subscriber.writable) {
            track.subscribers.delete(subscriber);
            continue;
          }
          const header = Buffer.allocUnsafe(4);
          header[0] = 0x24;
          header[1] = state.channel;
          header.writeUInt16BE(packet.length, 2);
          subscriber.write(Buffer.concat([header, packet]));
        }
      });
    }
    const port = (server.address() as { port: number }).port;
    return {
      port,
      publisherTargets: boundTracks.map((track) => ({ path: track.path, udpPort: track.udpPort })),
      async close(): Promise<void> {
        for (const socket of sessions.keys()) socket.destroy();
        await Promise.all([
          closeTcpServer(server).catch(() => undefined),
          ...boundTracks.map((track) => closeUdpSocket(track.udp).catch(() => undefined)),
        ]);
      },
    };
  } catch (error) {
    await Promise.all(boundTracks.map((track) => closeUdpSocket(track.udp).catch(() => undefined)));
    throw error;
  }
}
