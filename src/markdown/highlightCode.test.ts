import { describe, expect, it } from 'vitest'

import { tokenizeCode } from './highlightCode'

describe('tokenizeCode', () => {
  it('classifies keywords, calls, numbers, strings, and comments in a known language', () => {
    expect(tokenizeCode('const n = add(1) // total', 'js')).toEqual([
      { type: 'keyword', text: 'const' },
      { type: 'plain', text: ' ' },
      { type: 'plain', text: 'n' },
      { type: 'plain', text: ' = ' },
      { type: 'function', text: 'add' },
      { type: 'plain', text: '(' },
      { type: 'number', text: '1' },
      { type: 'plain', text: ') ' },
      { type: 'comment', text: '// total' },
    ])
  })

  it('matches SQL keywords case-insensitively', () => {
    expect(tokenizeCode('select * from users', 'sql')).toEqual([
      { type: 'keyword', text: 'select' },
      { type: 'plain', text: ' * ' },
      { type: 'keyword', text: 'from' },
      { type: 'plain', text: ' ' },
      { type: 'plain', text: 'users' },
    ])
  })

  it('only colours strings and numbers when the language is unrecognised or missing', () => {
    const line = 'const x = "y"'
    expect(tokenizeCode(line, 'made-up-language')).toEqual(tokenizeCode(line, null))
    expect(tokenizeCode(line, null)).toEqual([
      { type: 'plain', text: 'const' },
      { type: 'plain', text: ' ' },
      { type: 'plain', text: 'x' },
      { type: 'plain', text: ' = ' },
      { type: 'string', text: '"y"' },
    ])
  })

  describe('http', () => {
    it('colours a request line by method, path, and version', () => {
      expect(tokenizeCode('GET /api/users/123 HTTP/1.1', 'http')).toEqual([
        { type: 'keyword', text: 'GET' },
        { type: 'plain', text: ' ' },
        { type: 'string', text: '/api/users/123' },
        { type: 'plain', text: ' ' },
        { type: 'keyword', text: 'HTTP/1.1' },
      ])
    })

    it('colours a status line by version and code, leaving the reason phrase plain', () => {
      expect(tokenizeCode('HTTP/1.1 404 Not Found', 'https')).toEqual([
        { type: 'keyword', text: 'HTTP/1.1' },
        { type: 'plain', text: ' ' },
        { type: 'number', text: '404' },
        { type: 'plain', text: ' ' },
        { type: 'plain', text: 'Not Found' },
      ])
    })

    it('colours a header name and value, and scans a JSON body', () => {
      const tokens = tokenizeCode(
        'GET /health HTTP/1.1\nAuthorization: Bearer abc\n\n{"ok": true}',
        'http',
      )
      expect(tokens).toContainEqual({ type: 'function', text: 'Authorization' })
      expect(tokens).toContainEqual({ type: 'string', text: 'Bearer abc' })
      expect(tokens).toContainEqual({ type: 'keyword', text: 'true' })
    })

    it('leaves a non-JSON body as plain text', () => {
      const tokens = tokenizeCode('HTTP/1.1 200 OK\n\nOK', 'http')
      expect(tokens.at(-1)).toEqual({ type: 'plain', text: 'OK' })
    })
  })
})
