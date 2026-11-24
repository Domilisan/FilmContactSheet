import type { TaskContext, TaskProgress } from '../shared/model'

export type ImageJob = Record<string, unknown> & { kind: 'import' | 'export' }
type Execute = (job: ImageJob, signal: AbortSignal, progress: (value: { message: string; current: number; total: number }) => void) => Promise<unknown>
interface Entry {
  context: TaskContext; job: ImageJob; controller: AbortController; running: boolean
  resolve(value: unknown): void; reject(error: unknown): void; settled: Promise<void>
}
export const cancellationError = () => new Error('任务已取消。')

/** Two image workers at most; only one memory-heavy export at a time. */
export class ImageTaskQueue {
  private entries = new Map<string, Entry>()
  constructor(private execute: Execute, private notify: (progress: TaskProgress) => void) {}
  get size() { return this.entries.size }

  run<T>(context: TaskContext, job: ImageJob): Promise<T> {
    if (this.entries.has(context.taskId)) return Promise.reject(new Error('任务编号重复。'))
    let entry!: Entry
    const result = new Promise<T>((resolve, reject) => {
      entry = { context, job, controller: new AbortController(), running: false,
        resolve: value => resolve(value as T), reject, settled: Promise.resolve() }
      this.entries.set(context.taskId, entry)
    })
    entry.settled = result.then(() => {}, () => {})
    this.notify({ ...context, kind: job.kind, state: 'queued', message: '等待处理', current: 0, total: 0 })
    this.pump()
    return result
  }

  async cancel(taskId: string) {
    const entry = this.entries.get(taskId)
    if (!entry) return
    if (entry.running) entry.controller.abort()
    else { this.entries.delete(taskId); entry.reject(cancellationError()); this.pump() }
    await entry.settled
  }

  async cancelAll() {
    const entries = [...this.entries.values()]
    // Remove queued work before aborting workers so cancellation cannot start a waiting job.
    for (const entry of entries.filter(e => !e.running)) {
      this.entries.delete(entry.context.taskId); entry.reject(cancellationError())
    }
    for (const entry of entries.filter(e => e.running)) entry.controller.abort()
    await Promise.all(entries.map(e => e.settled))
  }

  private pump() {
    for (;;) {
      const running = [...this.entries.values()].filter(e => e.running)
      if (running.length >= 2) return
      const next = [...this.entries.values()].find(e => !e.running
        && (e.job.kind !== 'export' || !running.some(r => r.job.kind === 'export')))
      if (!next) return
      next.running = true
      const progress = (value: { message: string; current: number; total: number }) =>
        this.notify({ ...next.context, kind: next.job.kind, state: 'running', ...value })
      progress({ message: '正在准备…', current: 0, total: 0 })
      void Promise.resolve().then(() => this.execute(next.job, next.controller.signal, progress)).then(
        result => { this.entries.delete(next.context.taskId); this.pump(); next.resolve(result) },
        error => { this.entries.delete(next.context.taskId); this.pump(); next.reject(error) }
      )
    }
  }
}
