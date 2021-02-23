/**
 * @license
 * Copyright a-Qoot All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/a-Qoot/qoot/blob/main/LICENSE
 */

let importCache: Map<string, unknown | Promise<unknown>>;

export function qImport<T>(element: Element, url: string | URL): T | Promise<T> {
  if (!importCache) importCache = new Map<string, unknown | Promise<unknown>>();
  const baseURI = element.ownerDocument.baseURI;
  const _url = url instanceof URL ? url : new URL(url, baseURI);
  const pathname = _url.pathname;
  const cacheValue = importCache.get(pathname);
  if (cacheValue) return cacheValue as T;
  let dotIdx = pathname.lastIndexOf('.');
  let slashIdx = pathname.lastIndexOf('/');
  if (dotIdx === 0 || dotIdx < slashIdx) dotIdx = pathname.length;
  const promise = import(pathname.substr(0, dotIdx) + '.js').then((module) => {
    const key = pathname.substring(dotIdx + 1) || 'default';
    const handler = module[key];
    importCache.set(pathname, handler);
    return handler;
  });
  importCache.set(pathname, promise);
  return promise;
}