export interface WorkbenchSyncSchedulerOptions {
  debounceMs?: number
  intervalMs?: number
  sync: () => Promise<unknown>
}

export class WorkbenchSyncScheduler {
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private intervalTimer: ReturnType<typeof setInterval> | undefined
  private running: Promise<unknown> | undefined
  constructor(private readonly options: WorkbenchSyncSchedulerOptions) {}
  start(): void { this.stop(); if (this.options.intervalMs !== undefined && this.options.intervalMs > 0) this.intervalTimer = setInterval(() => { void this.run() }, this.options.intervalMs) }
  stop(): void { if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer); if (this.intervalTimer !== undefined) clearInterval(this.intervalTimer); this.debounceTimer = undefined; this.intervalTimer = undefined }
  notifyChanged(): void { if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer); this.debounceTimer = setTimeout(() => { void this.run() }, this.options.debounceMs ?? 1500) }
  run(): Promise<unknown> { if (this.running !== undefined) return this.running; this.running = this.options.sync().finally(() => { this.running = undefined }); return this.running }
  dispose(): void { this.stop() }
}
