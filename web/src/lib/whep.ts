/**
 * Cliente WHEP mínimo (WebRTC-HTTP Egress Protocol) usando RTCPeerConnection puro.
 * Envia uma oferta não-trickle (espera a coleta de ICE) e recebe a resposta SDP.
 */
export interface WhepSession {
  pc: RTCPeerConnection;
  close: () => void;
}

const ICE_GATHER_TIMEOUT_MS = 1500;

function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export async function startWhep(
  url: string,
  onTrack: (stream: MediaStream) => void,
  signal?: AbortSignal,
): Promise<WhepSession> {
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  let resourceUrl: string | null = null;

  const close = () => {
    pc.getReceivers().forEach((r) => r.track?.stop());
    pc.close();
    if (resourceUrl) {
      // Encerra a sessão no servidor (best effort).
      void fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
      resourceUrl = null;
    }
  };

  try {
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      onTrack(stream);
    };

    await pc.setLocalDescription(await pc.createOffer());
    await waitIceGathering(pc);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/sdp' },
      body: pc.localDescription?.sdp ?? '',
      signal,
    });
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`WHEP respondeu ${res.status}`);
    }
    const location = res.headers.get('location');
    if (location) resourceUrl = new URL(location, url).toString();
    const answer = await res.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    return { pc, close };
  } catch (err) {
    close();
    throw err;
  }
}
