// Acceptance-only preload. Enable solely in the disposable receiver process.
const net = require('node:net')
const dns = require('node:dns')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
// Native service operations scrub custom environment variables. CWD remains
// inside the isolated Profile, and NODE_OPTIONS is intentionally inherited.
const log = process.env.DSH_ACCEPTANCE_NETWORK_LOG || path.join(os.tmpdir(),'dsh-bay-172-isolated','receiver-network.jsonl')
if (!process.env.DSH_HOME?.includes('dsh-bay-172-isolated') && !process.cwd().includes('dsh-bay-172-isolated')) throw new Error('Acceptance network guard requires an isolated Profile')
const record = value => fs.appendFileSync(log, JSON.stringify({ pid: process.pid, ...value }) + '\n')
const allowed = host => !host || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host))
const deny = host => { record({ blocked: String(host) }); throw new Error('Acceptance receiver: external network disabled') }
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const host = typeof first === 'object' ? first.host : typeof first === 'number' && typeof args[1] === 'string' ? args[1] : undefined
  if (!allowed(host)) deny(host)
  return connect.apply(this, args)
}
const lookup = dns.lookup
dns.lookup = function (host, ...args) { if (!allowed(host)) deny(host); return lookup.call(this, host, ...args) }
record({ guarded: true, argv: process.argv.slice(0, 2) })
