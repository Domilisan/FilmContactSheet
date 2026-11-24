import { expect, test, vi } from 'vitest'
import { ImageTaskQueue, cancellationError } from '../src/main/task-queue'

function fixture() {
  const running = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void; signal: AbortSignal }>()
  const started: string[] = [], progress = vi.fn()
  const queue = new ImageTaskQueue((job, signal) => new Promise((resolve, reject) => {
    const id = String(job.id); started.push(id); running.set(id, { resolve, reject, signal })
    if (signal.aborted) reject(cancellationError())
    signal.addEventListener('abort', () => reject(cancellationError()), { once: true })
  }), progress)
  const submit = (id: string, kind: 'import' | 'export' = 'import') => queue.run({ taskId: id, projectId: `project-${id}` }, { id, kind })
  return { queue, submit, running, started, progress }
}

test('two workers, one export, and progress stays bound to the originating project', async () => {
  const f = fixture()
  const a = f.submit('a', 'export'), b = f.submit('b', 'export'), c = f.submit('c'), d = f.submit('d')
  await vi.waitFor(() => expect(f.started).toEqual(['a', 'c']))
  expect(f.progress).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'b', projectId: 'project-b', state: 'queued' }))
  f.running.get('c')!.resolve('C'); expect(await c).toBe('C')
  await vi.waitFor(() => expect(f.started).toEqual(['a', 'c', 'd']))
  f.running.get('a')!.resolve('A'); expect(await a).toBe('A')
  await vi.waitFor(() => expect(f.started).toEqual(['a', 'c', 'd', 'b']))
  f.running.get('b')!.resolve('B'); f.running.get('d')!.resolve('D')
  expect(await Promise.all([b, d])).toEqual(['B', 'D'])
  expect(f.queue.size).toBe(0)
})

test('canceling a queued task never launches it and does not cancel another project', async () => {
  const f = fixture(), a = f.submit('a'), b = f.submit('b'), c = f.submit('c')
  const canceled = expect(c).rejects.toThrow('任务已取消')
  await f.queue.cancel('c'); await canceled
  expect(f.started).not.toContain('c')
  expect(f.running.get('a')!.signal.aborted).toBe(false)
  f.running.get('a')!.resolve('A'); f.running.get('b')!.resolve('B')
  await Promise.all([a, b])
})

test('running cancellation and failure release capacity independently', async () => {
  const f = fixture(), a = f.submit('a'), b = f.submit('b'), c = f.submit('c')
  const canceled = expect(a).rejects.toThrow('任务已取消')
  await vi.waitFor(() => expect(f.started).toHaveLength(2))
  await f.queue.cancel('a'); await canceled
  await vi.waitFor(() => expect(f.started).toContain('c'))
  const failed = expect(b).rejects.toThrow('decode failed')
  f.running.get('b')!.reject(new Error('decode failed')); await failed
  f.running.get('c')!.resolve('C'); expect(await c).toBe('C')
  expect(f.queue.size).toBe(0)
})

test('shutdown cancels queued work before releasing running slots', async () => {
  const f = fixture(), results = [f.submit('a'), f.submit('b'), f.submit('c')]
  const settled = Promise.allSettled(results)
  await vi.waitFor(() => expect(f.started).toHaveLength(2))
  await f.queue.cancelAll()
  expect((await settled).every(result => result.status === 'rejected')).toBe(true)
  expect(f.started).toEqual(['a', 'b'])
  expect(f.queue.size).toBe(0)
})
