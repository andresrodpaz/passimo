import { describe, expect, it } from 'vitest'
import {
  extractVariables,
  missingVariables,
  renderTemplate,
  smsSegments,
  truncateForChannel,
} from '@/lib/messaging/template'
import { guessMapping, normaliseRow, parseCsv } from '@/lib/customers/import'

describe('renderTemplate', () => {
  it('substitutes known variables', () => {
    expect(
      renderTemplate('Hi {{customer_first_name}}, welcome to {{business_name}}', {
        customer_first_name: 'Ana',
        business_name: 'The Daily Grind',
      })
    ).toBe('Hi Ana, welcome to The Daily Grind')
  })

  it('renders an unknown variable as empty rather than leaving the braces', () => {
    // A customer must never receive a literal "{{first_name}}".
    expect(renderTemplate('Hi {{unknown}}!', {})).toBe('Hi !')
  })

  it('is case-insensitive and tolerates whitespace', () => {
    expect(renderTemplate('{{ Business_Name }}', { business_name: 'Café' })).toBe('Café')
  })

  it('does not evaluate anything beyond substitution', () => {
    expect(renderTemplate('{{a}}{{b}}', { a: '{{b}}', b: 'x' })).toBe('{{b}}x')
  })

  it('treats null and undefined as empty', () => {
    expect(renderTemplate('[{{a}}][{{b}}]', { a: null, b: undefined })).toBe('[][]')
  })
})

describe('extractVariables / missingVariables', () => {
  it('lists the variables a template uses', () => {
    expect(extractVariables('{{a}} and {{b}} and {{a}}')).toEqual(['a', 'b'])
  })

  it('reports variables with no value supplied', () => {
    expect(missingVariables('{{a}} {{b}}', { a: 'x' })).toEqual(['b'])
  })
})

describe('smsSegments', () => {
  it('counts a short GSM-7 message as one segment', () => {
    const result = smsSegments('Come back for a free coffee!')
    expect(result.segments).toBe(1)
    expect(result.unicode).toBe(false)
  })

  it('splits a long message into multiple segments', () => {
    expect(smsSegments('a'.repeat(200)).segments).toBe(2)
  })

  it('detects unicode and shortens the segment limit accordingly', () => {
    const result = smsSegments('🎉'.repeat(50))
    expect(result.unicode).toBe(true)
    expect(result.segments).toBeGreaterThan(1)
  })

  it('reports zero segments for an empty body', () => {
    expect(smsSegments('').segments).toBe(0)
  })
})

describe('truncateForChannel', () => {
  it('leaves short text untouched', () => {
    expect(truncateForChannel('hello', 'sms')).toBe('hello')
  })

  it('truncates on a word boundary and appends an ellipsis', () => {
    const long = `${'word '.repeat(60)}end`
    const result = truncateForChannel(long, 'push')
    expect(result.length).toBeLessThanOrEqual(178)
    expect(result.endsWith('…')).toBe(true)
    expect(result).not.toContain('wor…')
  })

  it('does not truncate for channels without a limit', () => {
    const long = 'x'.repeat(5000)
    expect(truncateForChannel(long, 'email')).toHaveLength(5000)
  })
})

describe('parseCsv', () => {
  it('parses headers and rows', () => {
    const { headers, rows } = parseCsv('email,name\nana@x.com,Ana\nluis@x.com,Luis')
    expect(headers).toEqual(['email', 'name'])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ email: 'ana@x.com', name: 'Ana' })
  })

  it('handles quoted fields containing commas', () => {
    const { rows } = parseCsv('email,note\nana@x.com,"Likes oat milk, no sugar"')
    expect(rows[0]!.note).toBe('Likes oat milk, no sugar')
  })

  it('handles escaped quotes', () => {
    const { rows } = parseCsv('name\n"She said ""hi"""')
    expect(rows[0]!.name).toBe('She said "hi"')
  })

  it('accepts semicolon-delimited files from European spreadsheets', () => {
    const { headers, rows } = parseCsv('email;name\nana@x.com;Ana')
    expect(headers).toEqual(['email', 'name'])
    expect(rows[0]!.name).toBe('Ana')
  })

  it('strips a UTF-8 BOM so the first header is not corrupted', () => {
    const { headers } = parseCsv('﻿email,name\nana@x.com,Ana')
    expect(headers[0]).toBe('email')
  })

  it('handles CRLF line endings', () => {
    const { rows } = parseCsv('email,name\r\nana@x.com,Ana\r\n')
    expect(rows).toHaveLength(1)
  })

  it('returns empty results for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
  })
})

describe('guessMapping', () => {
  it('maps common English headers', () => {
    expect(guessMapping(['Email', 'First Name', 'Phone'])).toEqual({
      Email: 'email',
      'First Name': 'first_name',
      Phone: 'phone',
    })
  })

  it('maps Spanish headers', () => {
    expect(guessMapping(['Correo', 'Nombre', 'Teléfono', 'Sellos'])).toEqual({
      Correo: 'email',
      Nombre: 'name',
      Teléfono: 'phone',
      Sellos: 'balance',
    })
  })

  it('normalises underscores and dashes', () => {
    expect(guessMapping(['first_name', 'last-name'])).toEqual({
      first_name: 'first_name',
      'last-name': 'last_name',
    })
  })

  it('leaves unrecognised headers unmapped rather than guessing wrong', () => {
    expect(guessMapping(['Internal Ref'])).toEqual({})
  })
})

/**
 * Row normalisation is where a bad import silently corrupts a whole customer
 * list. A birthday read as M/D instead of D/M sends the campaign on the wrong
 * day for a year; a mangled phone number is SMS spend with no recipient. Both
 * are invisible until months later, so the rules are pinned here.
 */
describe('normaliseRow', () => {
  const mapping = {
    Email: 'email',
    Name: 'name',
    Phone: 'phone',
    Birthday: 'birthday',
    Stamps: 'balance',
    Tags: 'tags',
    Marketing: 'consent_email',
  } as const

  it('lowercases email and trims every value', () => {
    const row = normaliseRow({ Email: '  Ana@Example.COM ', Name: '  Ana  ' }, mapping)
    expect(row.email).toBe('ana@example.com')
    expect(row.name).toBe('Ana')
  })

  it('skips empty cells rather than writing empty strings', () => {
    const row = normaliseRow({ Email: 'ana@x.com', Name: '   ', Phone: '' }, mapping)
    expect(row.name).toBeUndefined()
    expect(row.phone).toBeUndefined()
  })

  it('composes a display name from first and last when none was given', () => {
    const row = normaliseRow(
      { First: 'Ana', Last: 'García' },
      { First: 'first_name', Last: 'last_name' }
    )
    expect(row.name).toBe('Ana García')
  })

  it('does not overwrite an explicit name', () => {
    const row = normaliseRow(
      { Name: 'Ana G.', First: 'Ana', Last: 'García' },
      { Name: 'name', First: 'first_name', Last: 'last_name' }
    )
    expect(row.name).toBe('Ana G.')
  })

  describe('phone numbers', () => {
    it('keeps a leading + and strips formatting', () => {
      expect(normaliseRow({ Phone: '+34 600 123 456' }, mapping).phone).toBe('+34600123456')
      expect(normaliseRow({ Phone: '(600) 123-456' }, mapping).phone).toBe('600123456')
    })

    it('rejects anything too short to be a real number', () => {
      // Better to drop it than to spend money texting "12345".
      expect(normaliseRow({ Phone: '12345' }, mapping).phone).toBeUndefined()
      expect(normaliseRow({ Phone: 'n/a' }, mapping).phone).toBeUndefined()
    })
  })

  describe('dates', () => {
    it('accepts ISO directly', () => {
      expect(normaliseRow({ Birthday: '1990-04-07' }, mapping).birthday).toBe('1990-04-07')
      expect(normaliseRow({ Birthday: '1990-04-07T00:00:00Z' }, mapping).birthday).toBe('1990-04-07')
    })

    it('reads an ambiguous date as day-first, the European default', () => {
      expect(normaliseRow({ Birthday: '04/07/1990' }, mapping).birthday).toBe('1990-07-04')
    })

    it('detects an unambiguous US date and swaps it', () => {
      // 25 cannot be a month, so 12/25 must be December 25th.
      expect(normaliseRow({ Birthday: '12/25/1990' }, mapping).birthday).toBe('1990-12-25')
    })

    it('accepts dots and dashes as separators', () => {
      expect(normaliseRow({ Birthday: '07.04.1990' }, mapping).birthday).toBe('1990-04-07')
      expect(normaliseRow({ Birthday: '07-04-1990' }, mapping).birthday).toBe('1990-04-07')
    })

    it('expands a two-digit year', () => {
      expect(normaliseRow({ Birthday: '07/04/90' }, mapping).birthday).toBe('2090-04-07')
    })

    it('drops anything it cannot read with confidence', () => {
      for (const value of ['not a date', '13/13/1990', '00/04/1990', '7 April 1990', '1990']) {
        expect(normaliseRow({ Birthday: value }, mapping).birthday).toBeUndefined()
      }
    })
  })

  describe('balances', () => {
    it('accepts a comma decimal separator', () => {
      expect(normaliseRow({ Stamps: '12,5' }, mapping).balance).toBe(12.5)
    })

    it('ignores zero, negative and non-numeric balances', () => {
      // A negative imported balance would mean owing the merchant points.
      expect(normaliseRow({ Stamps: '0' }, mapping).balance).toBeUndefined()
      expect(normaliseRow({ Stamps: '-5' }, mapping).balance).toBeUndefined()
      expect(normaliseRow({ Stamps: 'lots' }, mapping).balance).toBeUndefined()
    })
  })

  describe('tags', () => {
    it('splits on any common separator and trims', () => {
      expect(normaliseRow({ Tags: 'vip, regular; coffee|oat' }, mapping).tags).toEqual([
        'vip',
        'regular',
        'coffee',
        'oat',
      ])
    })

    it('caps the number of tags so one bad cell cannot create hundreds', () => {
      const many = Array.from({ length: 40 }, (_, index) => `tag${index}`).join(',')
      expect(normaliseRow({ Tags: many }, mapping).tags).toHaveLength(10)
    })
  })

  describe('consent', () => {
    it('recognises affirmative values in English and Spanish', () => {
      for (const value of ['true', 'yes', 'Y', '1', 'si', 'Sí']) {
        expect(normaliseRow({ Marketing: value }, mapping).consent_email).toBe(true)
      }
    })

    it('treats anything else as no consent', () => {
      // Defaulting an unreadable value to "opted in" is a GDPR breach, not a bug.
      for (const value of ['false', 'no', '0', 'maybe', 'unknown']) {
        expect(normaliseRow({ Marketing: value }, mapping).consent_email).toBe(false)
      }
    })
  })

  it('ignores columns mapped to a field it does not handle', () => {
    const row = normaliseRow({ Ref: 'X-1' }, { Ref: 'internal_ref' })
    expect(row).toEqual({})
  })
})
