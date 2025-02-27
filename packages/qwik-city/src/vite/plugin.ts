import { createMdxTransformer, MdxTransform } from './mdx';
import { stat } from 'fs/promises';
import { isAbsolute } from 'path';
import type { ModuleGraph, ModuleNode, Plugin, ViteDevServer } from 'vite';
import { createBuildCode } from './code-generation';
import { loadPages } from './load-pages';
import type { PluginContext, PluginOptions } from './types';
import { getPagesBuildPath, normalizeOptions } from './utils';

/**
 * @public
 */
export function qwikCity(options: PluginOptions) {
  const ctx = normalizeOptions(options);
  let viteDevServer: ViteDevServer | undefined;
  let hasValidatedOpts = false;
  let qwikCityBuildCode: string | null = null;
  let mdxTransform: MdxTransform | null = null;
  let inlinedModules = false;

  const plugin: Plugin = {
    name: 'vite-plugin-qwik-city',

    enforce: 'pre',

    config(userConfig) {
      inlinedModules = !!userConfig.build?.ssr;
    },

    configureServer(server) {
      viteDevServer = server;
      inlinedModules = true;
    },

    handleHotUpdate(hmrCtx) {
      const changedFile = hmrCtx.file;
      if (viteDevServer && typeof changedFile === 'string') {
        // const moduleGraph = viteDevServer.moduleGraph;
        // const qwikCityMod = moduleGraph.getModuleById(RESOLVED_QWIK_CITY_ID);
        // if (isMarkdownFile(ctx, changedFile) || isPageModuleDependency(qwikCityMod, changedFile)) {
        //   qwikCityBuildCode = null;
        //   invalidatePageModule(moduleGraph, qwikCityMod);
        // }
      }
    },

    async buildStart() {
      qwikCityBuildCode = null;

      if (!hasValidatedOpts) {
        const err = await validatePlugin(ctx);
        if (err) {
          this.error(err);
        } else {
          hasValidatedOpts = true;
        }
      }

      if (!mdxTransform) {
        mdxTransform = await createMdxTransformer(ctx);
      }
    },

    resolveId(id) {
      if (id === QWIK_CITY_BUILD_ID) {
        return RESOLVED_QWIK_CITY_BUILD_ID;
      }
      return null;
    },

    async load(id) {
      if (id === RESOLVED_QWIK_CITY_BUILD_ID) {
        // @builder.io/qwik-city
        if (typeof qwikCityBuildCode === 'string') {
          return qwikCityBuildCode;
        }

        await loadPages(ctx, (msg) => this.warn(msg));

        if (inlinedModules) {
          // vite dev server build (esbuild)
          qwikCityBuildCode = createBuildCode(ctx, true);
        } else {
          // production (rollup)
          qwikCityBuildCode = createBuildCode(ctx, false);

          ctx.pages.forEach((p) => {
            this.emitFile({
              type: 'chunk',
              id: p.filePath,
              fileName: getPagesBuildPath(p.pathname),
              preserveSignature: 'allow-extension',
            });
          });
        }

        return qwikCityBuildCode;
      }
      return null;
    },

    async transform(code, id) {
      if (mdxTransform) {
        const mdxResult = await mdxTransform(code, id);
        return mdxResult;
      }
    },
  };

  return plugin as any;
}

function invalidatePageModule(moduleGraph: ModuleGraph, qwikCityMod: ModuleNode | undefined) {
  const checkedFiles = new Set<string>();
  const invalidate = (mod: ModuleNode | undefined) => {
    if (mod && mod.file && !checkedFiles.has(mod.file)) {
      checkedFiles.add(mod.file);
      moduleGraph.invalidateModule(mod);
      mod.importedModules.forEach(invalidate);
    }
  };
  invalidate(qwikCityMod);
}

function isPageModuleDependency(qwikCityMod: ModuleNode | undefined, changedFile: string) {
  const checkedFiles = new Set<string>();
  let isDep = false;
  const checkDep = (mod: ModuleNode | undefined) => {
    if (!isDep && mod && mod.file && !checkedFiles.has(mod.file)) {
      checkedFiles.add(mod.file);
      if (mod.file === changedFile) {
        isDep = true;
      } else {
        mod.importedModules.forEach(checkDep);
      }
    }
  };
  checkDep(qwikCityMod);
  return isDep;
}

const QWIK_CITY_BUILD_ID = '@builder.io/qwik-city/build';
const RESOLVED_QWIK_CITY_BUILD_ID = '\0' + QWIK_CITY_BUILD_ID;

async function validatePlugin(ctx: PluginContext) {
  if (typeof ctx.opts.pagesDir !== 'string') {
    return `qwikCity plugin "pagesDir" option missing`;
  }

  if (!isAbsolute(ctx.opts.pagesDir)) {
    return `qwikCity plugin "pagesDir" option must be an absolute path: ${ctx.opts.pagesDir}`;
  }

  try {
    const s = await stat(ctx.opts.pagesDir);
    if (!s.isDirectory()) {
      return `qwikCity plugin "pagesDir" option must be a directory: ${ctx.opts.pagesDir}`;
    }
  } catch (e) {
    return `qwikCity plugin "pagesDir" not found: ${e}`;
  }

  if (!ctx.opts.layouts) {
    return `qwikCity plugin "layouts" option missing`;
  }

  if (typeof ctx.opts.layouts.default !== 'string') {
    return `qwikCity plugin "layouts.default" option missing`;
  }

  if (!isAbsolute(ctx.opts.layouts.default)) {
    return `qwikCity plugin "layouts.default" option must be set to an absolute path: ${ctx.opts.layouts.default}`;
  }

  const layoutNames = Object.keys(ctx.opts.layouts);
  for (const layoutName of layoutNames) {
    const layoutPath = ctx.opts.layouts[layoutName];
    try {
      const s = await stat(layoutPath);
      if (!s.isFile()) {
        return `qwikCity plugin layout "${layoutName}" must be a file: ${layoutPath}`;
      }
    } catch (e) {
      return `qwikCity plugin layout "${layoutName}" not found: ${e}`;
    }
  }

  return null;
}
