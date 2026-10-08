'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * The only bridge between the UI and the main process. Exposes a small,
 * explicit API; the renderer never gets Node, require or raw ipcRenderer.
 */
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

const EVENTS = [
  'extraction:progress',
  'extraction:status',
  'campaign:progress',
  'campaign:paused',
  'campaign:finished',
  'campaign:alert',
  'campaign:started',
  'recipients:changed',
  'history:changed'
];

contextBridge.exposeInMainWorld('superMailer', {
  app: {
    info: () => invoke('app:info')
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch, password) => invoke('settings:update', { patch, password }),
    clearPassword: () => invoke('settings:update', { patch: {}, clearPassword: true }),
    testConnection: (patch, password) => invoke('settings:testConnection', { patch, password })
  },
  documents: {
    pick: (mode) => invoke('documents:pick', { mode }),
    /** Drag-and-drop: resolve dropped Files to filesystem paths and approve them. */
    pathsFromFiles: (files) => {
      const paths = Array.from(files || []).map((f) => {
        try {
          return webUtils.getPathForFile(f);
        } catch {
          return '';
        }
      }).filter(Boolean);
      return invoke('documents:approveDropped', { paths }).then(() => paths);
    },
    approvePaths: (paths) => invoke('documents:approveDropped', { paths }),
    extract: (paths) => invoke('documents:extract', { paths }),
    cancel: () => invoke('documents:cancel')
  },
  recipients: {
    list: (query) => invoke('recipients:list', query || {}),
    stats: () => invoke('recipients:stats'),
    setSelected: (emails, selected) => invoke('recipients:setSelected', { emails, selected }),
    selectAll: (filter) => invoke('recipients:selectAll', { filter }),
    clearSelection: () => invoke('recipients:clearSelection'),
    remove: (emails) => invoke('recipients:remove', { emails }),
    removeSelected: () => invoke('recipients:removeSelected'),
    removeInvalid: () => invoke('recipients:removeInvalid'),
    addManual: (email, firstName, lastName) => invoke('recipients:addManual', { email, firstName, lastName }),
    importCsv: () => invoke('recipients:importCsv'),
    exportCsv: (onlySelected) => invoke('recipients:exportCsv', { onlySelected }),
    clearAll: () => invoke('recipients:clearAll')
  },
  compose: {
    preview: (draft) => invoke('compose:preview', { draft }),
    sendTest: (draft, to) => invoke('compose:sendTest', { draft, to }),
    preflight: (draft) => invoke('compose:preflight', { draft })
  },
  campaign: {
    start: (draft, confirmedCount) => invoke('campaign:start', { draft, confirmedCount }),
    pause: () => invoke('campaign:pause'),
    resume: () => invoke('campaign:resume'),
    cancel: () => invoke('campaign:cancel'),
    status: () => invoke('campaign:status')
  },
  history: {
    list: () => invoke('history:list'),
    get: (id) => invoke('history:get', { id }),
    remove: (id) => invoke('history:remove', { id })
  },
  suppression: {
    list: () => invoke('suppression:list'),
    remove: (emails) => invoke('suppression:remove', { emails }),
    add: (emails) => invoke('suppression:add', { emails })
  },
  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on: (channel, handler) => {
    if (!EVENTS.includes(channel)) throw new Error(`Unknown event channel: ${channel}`);
    const wrapped = (_event, data) => handler(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
});
