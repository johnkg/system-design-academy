// A toy hop-by-hop model of MTU, fragmentation and Path MTU Discovery for one TCP transfer over IPv4.
// Assumptions: IP header 20 bytes, TCP header 20 bytes (no options), so packet size = MSS + 40. The path is a list of link MTUs
// and a tunnel is modelled as a link whose MTU is 1500 minus its overhead (here 100 bytes, a made-up round number; real tunnels
// add roughly 20 to 100 bytes depending on the protocol, e.g. GRE 24, VXLAN 50, WireGuard 60 over IPv4). TCP typically sets the Don't Fragment (DF) bit.
// A router that drops a DF packet typically sends ICMP "fragmentation needed" carrying the next hop's MTU, if ICMP is not filtered.
// Fragments carry data in multiples of 8 bytes. Losing any one fragment loses the whole packet. Loss is given per 10,000 fragments.

const HDR = 40, IP = 20;

// Walk the first full-size packet down the path and say what each hop does with it.
function trace(path, size, df) {
  const lines = [];
  for (let i = 0; i < path.length; i++) {
    const mtu = path[i];
    if (size <= mtu) lines.push(`hop ${i + 1} MTU ${mtu}: ${size} bytes pass`);
    else if (df) { lines.push(`hop ${i + 1} MTU ${mtu}: ${size} bytes with DF set, dropped`); break; }
    else {
      const per = Math.floor((mtu - IP) / 8) * 8;
      lines.push(`hop ${i + 1} MTU ${mtu}: fragmented into ${Math.ceil((size - IP) / per)} pieces of at most ${per} data bytes`);
      size = per + IP; // later hops see the largest fragment; reassembly happens only at the destination
    }
  }
  return lines;
}

function transfer(path, mss0, bytes, df, icmp, clamp, lossPer10k) {
  const pmtu = Math.min(...path);
  let mss = clamp ? Math.min(mss0, pmtu - HDR) : mss0; // an endpoint rewrites the MSS in the SYN
  const size = Math.min(mss, bytes) + HDR;
  let packets, frags = 1, wasted = 0, result;
  if (size <= pmtu) { packets = Math.ceil(bytes / mss); result = "complete"; }
  else if (!df) {
    frags = Math.ceil((mss + IP) / (Math.floor((pmtu - IP) / 8) * 8));
    packets = Math.ceil(bytes / mss); result = "complete (fragmented)";
  } else if (icmp) {
    mss = pmtu - HDR; packets = Math.ceil(bytes / mss); wasted = 1; result = "complete after path MTU discovery";
  } else { packets = 0; result = "stalled, 0 bytes delivered"; }
  let survive = 10000;
  for (let k = 0; k < frags; k++) survive = Math.floor((survive * (10000 - lossPer10k)) / 10000);
  const extra = wasted;
  return `path MTU=${pmtu} MSS=${mss} packets sent=${packets + wasted} wire fragments=${packets * frags} extra round trips=${extra} result=${result}; ${packets === 0 ? "no packets get through" : survive + " of 10000 packets survive"}`;
}

const CLEAN = [1500, 1500, 1500], TUNNEL = [1500, 1400, 1500], BYTES = 100000, LOSS = 100;
console.log("first full packet, DF set:   " + trace(TUNNEL, 1500, true).join(" | "));
console.log("first full packet, DF clear: " + trace(TUNNEL, 1500, false).join(" | "));
console.log("no tunnel:                       " + transfer(CLEAN, 1460, BYTES, true, true, false, LOSS));
console.log("tunnel, DF, ICMP allowed:        " + transfer(TUNNEL, 1460, BYTES, true, true, false, LOSS));
console.log("tunnel, DF, ICMP blocked:        " + transfer(TUNNEL, 1460, BYTES, true, false, false, LOSS));
console.log("tunnel, DF, ICMP blocked, 1 KB:  " + transfer(TUNNEL, 1460, 1000, true, false, false, LOSS));
console.log("tunnel, DF, ICMP blocked, clamp: " + transfer(TUNNEL, 1460, BYTES, true, false, true, LOSS));
console.log("tunnel, DF cleared:              " + transfer(TUNNEL, 1460, BYTES, false, false, false, LOSS));
