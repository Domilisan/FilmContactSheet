import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopApi, TaskProgress } from '../shared/model'

const api: DesktopApi & { newProject(): Promise<void> } = {
  chooseImport: (kind, context) => ipcRenderer.invoke('photos:choose', kind, context),
  importDropped: (files, context) => ipcRenderer.invoke('photos:drop', files.map(file => webUtils.getPathForFile(file)).filter(Boolean), context),
  replacePhoto: () => ipcRenderer.invoke('photos:replace'),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project, saveAs, currentPath = null, otherOpenPaths = []) => ipcRenderer.invoke('project:save', project, saveAs, currentPath, otherOpenPaths),
  newProject: () => ipcRenderer.invoke('project:new'),
  loadTemplate: () => ipcRenderer.invoke('template:load'),
  saveTemplate: template => ipcRenderer.invoke('template:save', template),
  exportProject: (project, options, context) => ipcRenderer.invoke('sheet:export', project, options, context),
  cancelTask: taskId => ipcRenderer.invoke('task:cancel', taskId),
  reveal: path => ipcRenderer.invoke('file:reveal', path),
  dirty: value => ipcRenderer.send('project:dirty', value),
  onProgress: callback => {
    const listener = (_event: unknown, progress: TaskProgress) => callback(progress)
    ipcRenderer.on('task:progress', listener)
    return () => { ipcRenderer.removeListener('task:progress', listener) }
  }
}
contextBridge.exposeInMainWorld('desktop', api)
