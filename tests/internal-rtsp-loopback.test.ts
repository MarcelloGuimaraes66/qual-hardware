import { createSocket as createUdpSocket } from "node:dgram";
import { createConnection, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { createInternalRtspLoopback } from "../src/server/internalRtspLoopback.js";

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("test_wait_timeout");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

function send(socket: Socket, request: string): void {
  socket.write(`${request}\r\n\r\n`);
}

describe("internal RTSP/RTP loopback", () => {
  it("serves SDP and relays local RTP packets over interleaved RTSP without external traffic", async () => {
    const loopback = await createInternalRtspLoopback([{ path: "calibration-0", codec: "h264" }]);
    const client = createConnection({ host: "127.0.0.1", port: loopback.port });
    const udp = createUdpSocket("udp4");
    const chunks: Buffer[] = [];
    client.on("data", (chunk) => chunks.push(chunk));
    try {
      await new Promise<void>((resolveConnect, rejectConnect) => {
        client.once("connect", resolveConnect);
        client.once("error", rejectConnect);
      });
      send(client, `DESCRIBE rtsp://127.0.0.1:${loopback.port}/calibration-0 RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp`);
      await until(() => Buffer.concat(chunks).includes(Buffer.from("a=rtpmap:96 H264/90000")));
      send(client, `SETUP rtsp://127.0.0.1:${loopback.port}/calibration-0/trackID=0 RTSP/1.0\r\nCSeq: 2\r\nTransport: RTP/AVP/TCP;unicast;interleaved=0-1`);
      await until(() => Buffer.concat(chunks).includes(Buffer.from("interleaved=0-1")));
      send(client, `PLAY rtsp://127.0.0.1:${loopback.port}/calibration-0 RTSP/1.0\r\nCSeq: 3\r\nSession: test`);
      await until(() => Buffer.concat(chunks).includes(Buffer.from("CSeq: 3")));
      chunks.length = 0;
      const packet = Buffer.from([0x80, 0x60, 0x00, 0x01, 0, 0, 0, 1, 0, 0, 0, 2, 0x65, 0x01]);
      udp.send(packet, loopback.publisherTargets[0]!.udpPort, "127.0.0.1");
      await until(() => {
        const payload = Buffer.concat(chunks);
        return payload.length >= packet.length + 4 && payload[0] === 0x24 &&
          payload.readUInt16BE(2) === packet.length && payload.subarray(4).equals(packet);
      });
      expect(loopback.port).toBeGreaterThan(0);
    } finally {
      client.destroy();
      udp.close();
      await loopback.close();
    }
  });
});
