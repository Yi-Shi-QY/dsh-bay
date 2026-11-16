import type { IDisposable, Terminal } from '@xterm/xterm'

const ansiKeys = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const
const specialKeys = ['foreground', 'background', 'cursor'] as const

function colorIndex(value: string): number | undefined {
  return /^\d+$/u.test(value) && Number(value) < 256 ? Number(value) : undefined
}

function oscColor(value: string): string | undefined {
  const rgb = /^rgb:([\da-f]{1,4})\/([\da-f]{1,4})\/([\da-f]{1,4})$/iu.exec(value)
  let channels: string[]
  if (rgb !== null) {
    channels = rgb.slice(1)
    if (!channels.every(channel => channel.length === channels[0]!.length)) return undefined
  } else {
    if (!/^#(?:[\da-f]{3}){1,4}$/iu.test(value)) return undefined
    const width = (value.length - 1) / 3
    channels = [value.slice(1, width + 1), value.slice(width + 1, 2 * width + 1), value.slice(2 * width + 1)]
  }
  return `#${channels.map(channel => (rgb === null
    ? Number.parseInt(channel.padEnd(2, '0').slice(0, 2), 16)
    : Math.round(Number.parseInt(channel, 16) * 255 / (16 ** channel.length - 1))).toString(16).padStart(2, '0')).join('')}`
}

/** DSH's xterm palette adapter: base tokens remain live while OSC overrides survive theme changes. */
export class DshTerminalTheme implements IDisposable {
  private defaults: Record<string, string> = {}
  private readonly indexed = new Map<number, string>()
  private readonly special = new Map<string, string>()
  private readonly subscriptions: IDisposable[]

  constructor(private readonly terminal: Terminal) {
    const observe = (code: number, change: (data: string) => void): IDisposable => terminal.parser.registerOscHandler(code, data => {
      change(data)
      return false
    })
    this.subscriptions = [
      observe(4, data => {
        const parts = data.split(';')
        for (let index = 0; index + 1 < parts.length; index += 2) {
          const key = colorIndex(parts[index]!)
          const color = oscColor(parts[index + 1]!)
          if (key !== undefined && color !== undefined) this.indexed.set(key, color)
        }
      }),
      observe(104, data => {
        if (data === '') this.indexed.clear()
        else for (const part of data.split(';')) {
          const key = colorIndex(part)
          if (key !== undefined) this.indexed.delete(key)
        }
        this.apply()
      }),
      ...specialKeys.flatMap((key, offset) => [
        observe(10 + offset, data => {
          for (const [index, part] of data.split(';').entries()) {
            const target = specialKeys[offset + index]
            const color = oscColor(part)
            if (target !== undefined && color !== undefined) this.special.set(target, color)
          }
        }),
        observe(110 + offset, () => {
          this.special.delete(key)
          this.apply()
        }),
      ]),
    ]
  }

  update(background: string, foreground: string): void {
    if (this.defaults.background === background && this.defaults.foreground === foreground) return
    this.defaults = {
      background,
      foreground,
      cursor: foreground,
      cursorAccent: background,
      selectionBackground: foreground,
      selectionForeground: background,
      selectionInactiveBackground: foreground,
    }
    this.apply()
  }

  get cursor(): string {
    return this.special.get('cursor') ?? this.defaults.cursor ?? '#ffffff'
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose()
  }

  private apply(): void {
    const theme: Record<string, unknown> = { ...this.defaults, ...Object.fromEntries(this.special) }
    for (const [index, color] of this.indexed) {
      if (index < ansiKeys.length) theme[ansiKeys[index]!] = color
      else {
        const extended = Array.isArray(theme.extendedAnsi) ? [...theme.extendedAnsi] : []
        extended[index - ansiKeys.length] = color
        theme.extendedAnsi = extended
      }
    }
    this.terminal.options.theme = theme
  }
}

function channelsOf(color: string): [number, number, number] {
  if (color.startsWith('#')) return [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map(value => Number.parseInt(value, 16)) as [number, number, number]
  const channels = color.match(/[\d.]+/gu)?.map(Number) ?? [255, 255, 255]
  return [channels[0] ?? 255, channels[1] ?? 255, channels[2] ?? 255]
}

function luminance(color: string): number {
  return channelsOf(color).map(channel => channel / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * ([.2126, .7152, .0722][index] ?? 0), 0)
}

function opaqueColor(color: string, fallback: () => string): string {
  const rgba = color.match(/[\d.]+/gu)?.map(Number)
  if (rgba === undefined || rgba.length < 4 || rgba[3] === undefined || rgba[3] >= 1) return color
  const surface = channelsOf(fallback())
  const alpha = rgba[3]
  return `rgb(${rgba.slice(0, 3).map((channel, index) => Math.round(channel * alpha + surface[index]! * (1 - alpha))).join(', ')})`
}

/** Keeps the DOM cursor visible on ANSI, inverse and transparent cells. */
export function observeDshTerminalCursor(terminal: Terminal, node: HTMLElement, preferredCursor: () => string): IDisposable {
  return terminal.onRender(() => {
    const cursor = node.querySelector<HTMLElement>('.xterm-cursor')
    if (cursor === null) return
    cursor.classList.remove('xterm-cursor')
    let background: string
    let foreground: string
    try {
      const style = getComputedStyle(cursor)
      foreground = style.color
      background = opaqueColor(style.backgroundColor, () => getComputedStyle(node.querySelector<HTMLElement>('.xterm-scrollable-element')!).backgroundColor)
    } finally {
      cursor.classList.add('xterm-cursor')
    }
    const preferred = opaqueColor(preferredCursor(), () => background)
    const backgroundLuminance = luminance(background)
    const preferredLuminance = luminance(preferred)
    const fill = (Math.max(backgroundLuminance, preferredLuminance) + .05) / (Math.min(backgroundLuminance, preferredLuminance) + .05) >= 3
      ? preferred : backgroundLuminance > .179 ? '#000000' : '#ffffff'
    node.style.setProperty('--terminal-cursor', fill)
    node.style.setProperty('--terminal-cursor-accent', luminance(fill) > .179 ? '#000000' : '#ffffff')
    node.style.setProperty('--terminal-cursor-cell-background', background)
    node.style.setProperty('--terminal-cursor-cell-foreground', foreground)
  })
}
