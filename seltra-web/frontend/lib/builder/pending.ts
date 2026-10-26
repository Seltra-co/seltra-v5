export type PendingBuild = { prompt: string; mode: 'build' | 'plan' | 'chat'; attachmentCount: number }
const DB = 'seltra-builder-handoff'
const STORE = 'payloads'
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function savePendingBuild(payload: { prompt: string; mode: PendingBuild['mode']; files: File[]; figma?: boolean }) {
  const id = crypto.randomUUID()
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ prompt: payload.prompt, mode: payload.mode, files: payload.files, figma: payload.figma }, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  sessionStorage.setItem('seltra:pending_builder', id)
}
export async function takePendingBuild(): Promise<({ prompt: string; mode: PendingBuild['mode']; files: File[]; figma?: boolean }) | null> {
  const id = sessionStorage.getItem('seltra:pending_builder')
  if (!id) return null
  sessionStorage.removeItem('seltra:pending_builder')
  const db = await openDb()
  const value = await new Promise<{ prompt: string; mode: PendingBuild['mode']; files: File[]; figma?: boolean } | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
  return value ?? null
}
