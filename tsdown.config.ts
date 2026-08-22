import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig, type Plugin } from 'tsdown'

const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

const CSS_PREFIX = '\0dsh-bridge-css:'
const CSS_SUFFIX = '.mjs'
const CLIENT_MODULE_ID = 'dsh-openai-responses-bridge'
const CLIENT_SOURCE_ROOT = resolve('src/client')

/** Keep LightningCSS module hashes independent of the checkout path and OS. */
function stableCssFilename(file: string): string {
  return relative(CLIENT_SOURCE_ROOT, file).split(sep).join('/')
}

function cssModulesPlugin(id: string): Plugin {
  const virtualFiles = new Map<string, string>()
  return {
    name: 'dsh-bridge-css-modules',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      const file = resolve(dirname(importer ?? process.cwd()), source)
      const virtualId = `${CSS_PREFIX}${id}/${basename(file)}${CSS_SUFFIX}`
      virtualFiles.set(virtualId, file)
      return virtualId
    },
    async load(virtualId) {
      const file = virtualFiles.get(virtualId)
      if (file === undefined) return null
      this.addWatchFile(file)
      const source = await readFile(file)
      const result = transform({
        filename: stableCssFilename(file),
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exported] of Object.entries(result.exports ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        classMap[local] = exported.name
      }
      const tagId = `${id}/${basename(file)}`
      return [
        `const css = ${JSON.stringify(result.code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\\"" + tagId + "\\"]") === null) {',
        '  const tag = document.createElement("style");',
        `  tag.dataset.plugin = ${JSON.stringify(id)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }
}

export default defineConfig([
  {
    name: 'dsh-openai-responses-bridge',
    entry: ['src/index.ts'],
    outDir: 'lib',
    dts: true,
    clean: true,
    format: ['esm'],
    platform: 'node',
    deps: {
      neverBundle: [
        /^@deepseek-ai\//,
        /^@earendil-works\/pi-ai$/,
      ],
    },
  },
  {
    name: 'dsh-openai-responses-bridge/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    clean: false,
    dts: false,
    format: ['cjs'],
    platform: 'browser',
    deps: {
      neverBundle: PLATFORM_MODULES,
      alwaysBundle: (moduleId: string) => PLATFORM_MODULES.includes(moduleId) ? undefined : true,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [cssModulesPlugin('llm-openai-responses-bridge')],
    outputOptions: {
      exports: 'named',
      entryFileNames: 'client.js',
      // client-modules keys the browser bundle by the loaded package entry
      // name. The Host settings namespace has a different technical identity
      // (`llm-openai-responses-bridge`) and must not be used here.
      banner: `window.__ModuleLoader__.load({ id: "${CLIENT_MODULE_ID}", factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
