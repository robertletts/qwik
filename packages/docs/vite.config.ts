import { defineConfig, Plugin } from 'vite';
import { qwikVite, TransformModuleInput } from '@builder.io/qwik/optimizer';
import { resolve, join, basename } from 'path';
import { qwikCity } from '@builder.io/qwik-city/vite';
import { partytownVite } from '@builder.io/partytown/utils';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import type { TutorialApp, TutorialSection } from './src/layouts/tutorial/tutorial-data';
import type { PlaygroundApp } from './src/layouts/playground/playground-data';
import type { PluginContext } from 'rollup';
import esbuild from 'esbuild';
import type { ReplModuleInput } from './src/components/repl/types';

export default defineConfig(() => {
  const pagesDir = resolve('pages');

  return {
    build: {
      rollupOptions: {
        input: [
          resolve('src', 'components', 'app', 'app.tsx'),
          resolve('src', 'components', 'repl', 'worker', 'repl-service-worker.tsx'),
        ],
      },
    },
    plugins: [
      qwikCity({
        pagesDir,
        layouts: {
          tutorial: resolve('src', 'layouts', 'tutorial', 'tutorial.tsx'),
          default: resolve('src', 'layouts', 'docs', 'docs.tsx'),
        },
      }),
      qwikVite(),
      partytownVite({
        dest: resolve('dist', '~partytown'),
      }),
      playgroundData(pagesDir),
      tutorialData(pagesDir),
      replServiceWorker(),
    ],
    optimizeDeps: {
      include: ['@builder.io/qwik'],
    },
    clearScreen: false,
  };
});

function playgroundData(pagesDir: string): Plugin {
  const playgroundDir = join(pagesDir, 'playground');
  const playgroundMenuSrc = readFileSync(join(playgroundDir, 'playground-menu.json'), 'utf-8');

  const loadPlaygroundData = (ctx: PluginContext) => {
    const menuApps: PlaygroundApp[] = JSON.parse(playgroundMenuSrc);
    ctx.addWatchFile(playgroundMenuSrc);

    const apps: PlaygroundApp[] = [];

    try {
      for (const menuApp of menuApps) {
        const appDir = join(playgroundDir, menuApp.id);

        const app: PlaygroundApp = {
          ...menuApp,
          inputs: readdirSync(appDir).map((fileName) => {
            const filePath = join(appDir, fileName);
            const input: TransformModuleInput = {
              path: '/' + fileName,
              code: readFileSync(filePath, 'utf-8'),
            };
            ctx.addWatchFile(filePath);
            return input;
          }),
        };

        if (app.inputs.length > 0) {
          apps.push(app);
        }
      }
    } catch (e) {
      console.error(e);
    }

    return apps;
  };

  return {
    name: 'playgroundData',

    async load(id) {
      const filename = basename(id);
      if (filename === 'playground-data.ts') {
        const data = loadPlaygroundData(this);
        return `const playgroundApps = ${JSON.stringify(data)};export default playgroundApps;`;
      }
      return null;
    },
  };
}

function tutorialData(pagesDir: string): Plugin {
  const tutorialDir = join(pagesDir, 'tutorial');
  const tutorialMenuSrc = readFileSync(join(tutorialDir, 'tutorial-menu.json'), 'utf-8');

  const loadTutorialData = async (ctx: PluginContext) => {
    const tutorialSections: TutorialSection[] = [];
    const dataSections: TutorialSection[] = JSON.parse(tutorialMenuSrc);
    ctx.addWatchFile(tutorialMenuSrc);

    for (const dataSection of dataSections) {
      const tutorialSectionDir = join(tutorialDir, dataSection.id);

      if (!existsSync(tutorialSectionDir)) {
        throw new Error(`Tutorial section "${tutorialSectionDir}" doesn't exist`);
      }

      const s = statSync(tutorialSectionDir);
      if (!s.isDirectory()) {
        throw new Error(`Tutorial section "${tutorialSectionDir}" is not a directory`);
      }

      const tutorialSection: TutorialSection = {
        ...dataSection,
        tutorials: [],
      };

      for (const dataTutorial of dataSection.tutorials) {
        const tutorialAppDir = join(tutorialSectionDir, dataTutorial.id);
        if (!existsSync(tutorialAppDir)) {
          throw new Error(`Tutorial app "${tutorialAppDir}" doesn't exist`);
        }

        const s = statSync(tutorialAppDir);
        if (!s.isDirectory()) {
          throw new Error(`Tutorial app "${tutorialAppDir}" is not a directory`);
        }

        const readAppInputs = (appType: 'problem' | 'solution') => {
          const appDir = join(tutorialAppDir, appType);

          if (!existsSync(appDir)) {
            throw new Error(`Tutorial "${appType}" dir "${appDir}" doesn't exist`);
          }

          const s = statSync(tutorialSectionDir);
          if (!s.isDirectory()) {
            throw new Error(`Tutorial "${appType}" dir "${appDir}" is not a directory`);
          }

          const inputs: ReplModuleInput[] = readdirSync(appDir)
            .map((fileName) => {
              const filePath = join(appDir, fileName);
              const s = statSync(filePath);
              if (s.isFile()) {
                const input: ReplModuleInput = {
                  path: '/' + fileName,
                  code: readFileSync(filePath, 'utf-8'),
                };
                ctx.addWatchFile(filePath);
                return input;
              } else {
                return null;
              }
            })
            .filter((i) => i !== null) as any;

          if (inputs.length === 0) {
            throw new Error(`Tutorial "${appType}" dir "${appDir}" does not have any valid files.`);
          }
          if (!inputs.some((i) => i.path === '/app.tsx')) {
            throw new Error(
              `Tutorials must have an "app.tsx" file, which wasn't found in "${appType}" dir "${appDir}".`
            );
          }

          return inputs;
        };

        const tutorial: TutorialApp = {
          ...dataTutorial,
          id: `${tutorialSection.id}/${dataTutorial.id}`,
          problemInputs: readAppInputs('problem'),
          solutionInputs: readAppInputs('solution'),
        };

        tutorialSection.tutorials.push(tutorial);
      }

      if (tutorialSection.tutorials.length > 0) {
        tutorialSections.push(tutorialSection);
      } else {
        throw new Error(`Tutorial section "${tutorialSection.id}" has no tutorials`);
      }
    }

    return tutorialSections;
  };

  return {
    name: 'tutorialData',

    async load(id) {
      const filename = basename(id);
      if (filename === 'tutorial-data.ts') {
        const data = await loadTutorialData(this);
        return `const tutorials = ${JSON.stringify(data)};export default tutorials;`;
      }
      return null;
    },
  };
}

function replServiceWorker(): Plugin {
  return {
    name: 'replServiceWorker',

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/repl/repl-sw.js') {
          try {
            const swPath = resolve('src', 'components', 'repl', 'worker', 'repl-service-worker.ts');

            const result = await esbuild.build({
              entryPoints: [swPath],
              bundle: true,
              format: 'iife',
              write: false,
            });

            res.setHeader('Content-Type', 'application/javascript');
            res.writeHead(200);

            res.write(result.outputFiles![0].text);
            res.end();
            return;
          } catch (e) {
            console.error(e);
          }
        }
        next();
      });
    },

    generateBundle(opts, bundles) {
      if (opts.format === 'es') {
        for (const f in bundles) {
          const bundle = bundles[f];
          if (bundle.type === 'chunk') {
            if (bundle.name === 'repl-service-worker') {
              this.emitFile({
                type: 'asset',
                fileName: 'repl/repl-sw.js',
                source: bundle.code,
              });
            }
          }
        }
      }
    },
  };
}
