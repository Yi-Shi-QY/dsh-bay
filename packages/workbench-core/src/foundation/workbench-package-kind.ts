/** Detect the archive container; each Host importer still validates its manifest and content. */
export function workbenchPackageKind(header: Uint8Array): 'complete' | 'distribution' {
  if (header[0] === 0x1f && header[1] === 0x8b) return 'complete'
  if (header[0] === 0x50 && header[1] === 0x4b && header[2] === 3 && header[3] === 4) return 'distribution'
  throw new Error('无法识别工作台包。请选择完整工作台包（.tar.gz / .tgz）或工作台模板包（.wbpkg / .zip）；原始诊断 JSON 不用于导入。')
}
