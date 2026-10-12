import { isIPv4, isIPv6 } from 'node:net';

// The key a per-address limit counts by. One IPv6 customer usually holds a whole /64, so it counts as one address.
export function ipKey(ip) {
  const a = String(ip ?? '').replace(/%.*$/, '');
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  if (isIPv4(a) || !isIPv6(a)) return a;
  const [head, tail = ''] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...h, ...Array(Math.max(8 - h.length - t.length, 0)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map(g => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
