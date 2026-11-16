import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Exclusive writer boundary shared by Host processes. A live owner is never evicted. */
export function acquireFileLock(file: string): () => void {
  mkdirSync(path.dirname(file), { recursive: true })
  const token = randomUUID()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx', 0o600)
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })) } finally { closeSync(fd) }
      return () => {
        if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).token === token) unlinkSync(file)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = JSON.parse(readFileSync(file, 'utf8')) as { pid: number }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('写入锁损坏，需要检查：' + file)
      try { process.kill(owner.pid, 0) } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { unlinkSync(file); continue }
        throw probe
      }
      throw new Error('另一宿主正在修改此工作台，请稍后重试。')
    }
  }
  throw new Error('无法取得工作台写入锁。')
}
