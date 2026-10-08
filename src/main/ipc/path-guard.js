'use strict';

const path = require('path');

/**
 * Only paths the user explicitly chose (file dialog, folder dialog or drag-and-drop)
 * may be read by the extraction engine. A renderer cannot ask the main process
 * to read arbitrary files on disk.
 */
class PathGuard {
  constructor() {
    this.roots = new Set();
  }

  approve(p) {
    if (typeof p === 'string' && p.length > 0 && path.isAbsolute(p)) {
      this.roots.add(path.resolve(p));
    }
  }

  approveAll(list) {
    (list || []).forEach((p) => this.approve(p));
  }

  isApproved(p) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
    const resolved = path.resolve(p);
    for (const root of this.roots) {
      if (resolved === root) return true;
      if (resolved.startsWith(root + path.sep)) return true;
    }
    return false;
  }

  filter(list) {
    return (Array.isArray(list) ? list : []).filter((p) => this.isApproved(p));
  }
}

module.exports = { PathGuard };
