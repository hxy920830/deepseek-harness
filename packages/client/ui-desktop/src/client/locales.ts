/** `settings.desktop` dictionaries for desktop close behavior. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'settings.close.title': '关闭主窗口时',
  'settings.close.description': '选择点击关闭按钮后的默认操作',
  'settings.close.ask': '每次询问',
  'settings.close.minimize': '最小化到系统托盘',
  'settings.close.exit': '退出应用',
  'settings.sessionlog.title': 'Session 日志保存位置',
  'settings.sessionlog.description': '选择 Session log 导出 ZIP 的默认保存文件夹',
  'settings.sessionlog.pick': '选择文件夹',
  'settings.sessionlog.default': '默认下载位置',
  'dialog.title': '关闭 DeepSeek Harness',
  'dialog.description': '要最小化到系统托盘，还是退出应用？',
  'dialog.remember': '记住我的选择',
  'dialog.cancel': '取消',
  'dialog.minimize': '最小化到托盘',
  'dialog.exit': '退出应用',
  'dialog.close': '关闭',
  'dialog.error': '无法完成关闭操作，请重试。',
} satisfies Record<string, string>

/** Desktop locale key union. */
export type DesktopKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'settings.close.title': 'When closing the main window',
  'settings.close.description': 'Choose the default action for the close button',
  'settings.close.ask': 'Ask every time',
  'settings.close.minimize': 'Minimize to system tray',
  'settings.close.exit': 'Exit the application',
  'settings.sessionlog.title': 'Session log download location',
  'settings.sessionlog.description': 'Pick the default folder for exported Session log ZIP archives',
  'settings.sessionlog.pick': 'Choose folder',
  'settings.sessionlog.default': 'Default download location',
  'dialog.title': 'Close DeepSeek Harness',
  'dialog.description': 'Minimize to the system tray or exit the application?',
  'dialog.remember': 'Remember my choice',
  'dialog.cancel': 'Cancel',
  'dialog.minimize': 'Minimize to tray',
  'dialog.exit': 'Exit application',
  'dialog.close': 'Close',
  'dialog.error': 'Could not complete the close action. Try again.',
} satisfies Record<DesktopKey, string>
