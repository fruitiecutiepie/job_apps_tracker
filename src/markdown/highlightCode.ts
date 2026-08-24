/**
 * A hand-rolled tokenizer for fenced code blocks, in the same spirit as parseMarkdown's
 * own scanner: no dependency, just enough per language to colour comments, strings,
 * numbers, keywords, and called names for the languages that turn up in interview prep
 * notes. An unrecognised or missing language still gets strings and numbers coloured,
 * since those read the same in almost any language; keywords and comments are skipped
 * there because guessing them wrong is worse than leaving the line plain.
 */

export type CodeTokenType = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'function'

export interface CodeToken {
  type: CodeTokenType
  text: string
}

interface LangConfig {
  keywords: Set<string>
  caseInsensitive?: boolean
  lineComment: string[]
  blockComment?: [string, string]
  strings: string[]
}

function keywordSet(words: string): Set<string> {
  return new Set(words.split(' '))
}

const C_STYLE_COMMENTS: Pick<LangConfig, 'lineComment' | 'blockComment'> = {
  lineComment: ['//'],
  blockComment: ['/*', '*/'],
}

const JS_KEYWORDS = keywordSet(
  'const let var function return if else for while do switch case break continue class '
  + 'extends new this import export from default async await try catch finally throw '
  + 'typeof instanceof in of null undefined true false void yield static get set super '
  + 'implements interface type enum namespace declare as readonly public private protected',
)

const PYTHON_KEYWORDS = keywordSet(
  'def return if elif else for while break continue class import from as pass try except '
  + 'finally raise with lambda yield global nonlocal assert del is in not and or None True '
  + 'False async await self',
)

const SQL_KEYWORDS = keywordSet(
  'SELECT FROM WHERE JOIN LEFT RIGHT INNER OUTER FULL ON GROUP BY ORDER HAVING INSERT INTO '
  + 'VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP AS AND OR NOT NULL IS IN LIKE LIMIT '
  + 'OFFSET UNION ALL DISTINCT CASE WHEN THEN END EXISTS DEFAULT PRIMARY KEY FOREIGN '
  + 'REFERENCES INDEX',
)

const BASH_KEYWORDS = keywordSet(
  'if then else elif fi for while until do done case esac function return export local '
  + 'echo set in break continue',
)

const JAVA_KEYWORDS = keywordSet(
  'public private protected class interface extends implements static final void new '
  + 'return if else for while switch case break continue try catch finally throw throws '
  + 'import package this super null true false enum abstract synchronized volatile '
  + 'instanceof',
)

const GO_KEYWORDS = keywordSet(
  'func package import var const type struct interface map chan go defer return if else '
  + 'for range switch case break continue default fallthrough select nil true false make '
  + 'new',
)

const RUST_KEYWORDS = keywordSet(
  'fn let mut return if else for while loop match struct enum impl trait pub use mod '
  + 'crate self Self as ref move box true false None Some Ok Err async await where dyn',
)

const RUBY_KEYWORDS = keywordSet(
  'def end return if elif elsif else unless for while until case when break next class '
  + 'module require require_relative include extend attr_accessor attr_reader attr_writer '
  + 'do begin rescue ensure raise yield self nil true false and or not',
)

const C_KEYWORDS = keywordSet(
  'int char float double void long short unsigned signed struct union enum typedef '
  + 'return if else for while do switch case break continue goto sizeof static const '
  + 'extern volatile NULL true false',
)

const PHP_KEYWORDS = keywordSet(
  'function return if elseif else for foreach while do switch case break continue class '
  + 'extends implements new public private protected static const echo print require '
  + 'require_once include include_once namespace use try catch finally throw null true '
  + 'false as global',
)

const CONFIGS: Record<string, LangConfig> = {
  javascript: { keywords: JS_KEYWORDS, ...C_STYLE_COMMENTS, strings: ['"', "'", '`'] },
  typescript: {
    keywords: JS_KEYWORDS,
    ...C_STYLE_COMMENTS,
    strings: ['"', "'", '`'],
  },
  python: { keywords: PYTHON_KEYWORDS, lineComment: ['#'], strings: ['"', "'"] },
  sql: {
    keywords: SQL_KEYWORDS,
    caseInsensitive: true,
    lineComment: ['--'],
    strings: ["'", '"'],
  },
  bash: { keywords: BASH_KEYWORDS, lineComment: ['#'], strings: ['"', "'"] },
  json: { keywords: keywordSet('true false null'), lineComment: [], strings: ['"'] },
  java: { keywords: JAVA_KEYWORDS, ...C_STYLE_COMMENTS, strings: ['"'] },
  go: { keywords: GO_KEYWORDS, ...C_STYLE_COMMENTS, strings: ['"', '`'] },
  rust: { keywords: RUST_KEYWORDS, ...C_STYLE_COMMENTS, strings: ['"'] },
  ruby: { keywords: RUBY_KEYWORDS, lineComment: ['#'], strings: ['"', "'"] },
  php: { keywords: PHP_KEYWORDS, ...C_STYLE_COMMENTS, strings: ['"', "'"] },
  c: { keywords: C_KEYWORDS, ...C_STYLE_COMMENTS, strings: ['"'] },
  css: { keywords: new Set(), blockComment: ['/*', '*/'], lineComment: [], strings: ['"', "'"] },
  yaml: { keywords: keywordSet('true false null'), lineComment: ['#'], strings: ['"', "'"] },
}

// Languages people spell more than one way, mapped onto the config above.
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  py3: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  golang: 'go',
  rs: 'rust',
  rb: 'ruby',
  'c++': 'c',
  cpp: 'c',
  cc: 'c',
  h: 'c',
  yml: 'yaml',
}

// No language tag, or one we don't know: only strings and numbers are unambiguous
// enough to colour without knowing the grammar.
const FALLBACK_CONFIG: LangConfig = { keywords: new Set(), lineComment: [], strings: ['"', "'", '`'] }

function configFor(language: string | null): LangConfig {
  if (!language) return FALLBACK_CONFIG
  const name = language.toLowerCase()
  return CONFIGS[name] ?? CONFIGS[ALIASES[name]] ?? FALLBACK_CONFIG
}

const NUMBER = /^0[xX][0-9a-fA-F]+|^\d+(\.\d+)?([eE][+-]?\d+)?/
const WORD = /^[A-Za-z_$][A-Za-z0-9_$]*/

export function tokenizeCode(value: string, language: string | null): CodeToken[] {
  const config = configFor(language)
  const tokens: CodeToken[] = []
  let plain = ''
  let index = 0

  const flush = () => {
    if (plain) {
      tokens.push({ type: 'plain', text: plain })
      plain = ''
    }
  }

  while (index < value.length) {
    const rest = value.slice(index)
    const character = value[index]

    if (config.blockComment && rest.startsWith(config.blockComment[0])) {
      const close = value.indexOf(config.blockComment[1], index + config.blockComment[0].length)
      const end = close === -1 ? value.length : close + config.blockComment[1].length
      flush()
      tokens.push({ type: 'comment', text: value.slice(index, end) })
      index = end
      continue
    }

    const lineComment = config.lineComment.find((marker) => rest.startsWith(marker))
    if (lineComment) {
      const close = value.indexOf('\n', index)
      const end = close === -1 ? value.length : close
      flush()
      tokens.push({ type: 'comment', text: value.slice(index, end) })
      index = end
      continue
    }

    if (config.strings.includes(character)) {
      let cursor = index + 1
      while (cursor < value.length && value[cursor] !== character) {
        cursor += cursor < value.length && value[cursor] === '\\' ? 2 : 1
      }
      const end = Math.min(cursor + 1, value.length)
      flush()
      tokens.push({ type: 'string', text: value.slice(index, end) })
      index = end
      continue
    }

    // A digit that opens an identifier (`3rd`, inside `abc123`) is not a number of its
    // own, so this only fires where no identifier character precedes it.
    const number = /\d/.test(character) && !/[A-Za-z0-9_$]/.test(value[index - 1] ?? '')
      ? NUMBER.exec(rest)
      : null
    if (number) {
      flush()
      tokens.push({ type: 'number', text: number[0] })
      index += number[0].length
      continue
    }

    const word = WORD.exec(rest)
    if (word) {
      flush()
      const raw = word[0]
      const key = config.caseInsensitive ? raw.toUpperCase() : raw
      const isKeyword = config.keywords.has(key)
      const isCall = !isKeyword && value[index + raw.length] === '('
      tokens.push({ type: isKeyword ? 'keyword' : isCall ? 'function' : 'plain', text: raw })
      index += raw.length
      continue
    }

    plain += character
    index += 1
  }

  flush()
  return tokens
}
