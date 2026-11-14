(() => {
  const embedded = document.getElementById('embedded-reports')
  const reports = new Map()
  const byId = new Map()
  let selectedId = null
  let toastTimer

  const text = value => String(value ?? '')
  const escapeHtml = value => text(value).replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
  const reportId = report => `${report.github?.latestCommit ?? report.baseline?.upstreamCommit ?? 'unknown'}:${report.generatedAt ?? ''}:${report.mode ?? ''}`
  const dateValue = value => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const dateTime = value => {
    const date = dateValue(value)
    return date ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '时间未知'
  }
  const shortDate = value => {
    const date = dateValue(value)
    return date ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date) : '--'
  }
  const number = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat('zh-CN').format(Number(value)) : '—'
  const statusLabel = status => ({
    passed: '扫描通过',
    'drift-detected': '发现漂移',
    partial: '扫描不完整',
  })[status] ?? '状态未知'
  const severityRank = value => ({ P1: 0, P2: 1, P3: 2 })[value] ?? 3
  const kindLabel = value => ({
    'dependency-area-change': '依赖目录变化',
    'source-copy-change': '源码镜像变化',
    'newer-version': '存在较新版本',
    'peer-contract-drift': 'Peer 契约变化',
    'exports-drift': 'Exports 变化',
    'upstream-commit': '上游版本前进',
    'integrity-baseline-unpinned': 'Integrity 未固定',
    'unmapped-upstream-path': '上游路径未映射',
    'upstream-git-error': 'Git 拉取异常',
    'npm-metadata-error': 'npm 元数据异常',
  })[value] ?? value ?? '其他信号'
  const runtimeLabel = row => row.runtimeSourceChanged ? '运行时代码' : '版本、文档与测试'
  const statusTone = status => status === 'passed' ? 'passed' : status === 'partial' ? 'partial' : 'drift'
  const severityClass = value => ['P1', 'P2', 'P3'].includes(value) ? value : 'P2'
  const addReport = report => {
    if (!report || report.schemaVersion !== 1 || report.mode !== 'remote' || !report.baseline || !report.summary || !report.github?.comparison) return false
    const id = reportId(report)
    if (reports.has(id)) return false
    reports.set(id, report)
    byId.set(id, report)
    return true
  }

  let embeddedReports = []
  try { embeddedReports = JSON.parse(embedded.textContent || '[]') } catch { embeddedReports = [] }
  embeddedReports.forEach(addReport)

  const getRows = report => report.findings ?? []
  const getDeps = report => report.github?.comparison?.dependencyImpacts ?? []
  const latestReports = () => [...reports.entries()].sort((left, right) => {
    const a = dateValue(left[1].generatedAt)?.getTime() ?? 0
    const b = dateValue(right[1].generatedAt)?.getTime() ?? 0
    return a - b
  })
  const toast = message => {
    const node = document.getElementById('toast')
    node.textContent = message
    node.classList.add('visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => node.classList.remove('visible'), 3200)
  }
  const setText = (id, value) => { document.getElementById(id).textContent = value }
  const safeValue = value => escapeHtml(value)

  function fillSelect() {
    const select = document.getElementById('report-select')
    const items = latestReports().reverse()
    if (!items.some(([id]) => id === selectedId)) selectedId = items[0]?.[0] ?? null
    select.innerHTML = items.map(([id, report]) => {
      const label = `${dateTime(report.generatedAt)} · ${report.github?.latestTag ?? '无 DSH 标签'}`
      return `<option value="${safeValue(id)}"${id === selectedId ? ' selected' : ''}>${safeValue(label)}</option>`
    }).join('')
    select.disabled = items.length < 2
  }

  function renderTrend(items) {
    const node = document.getElementById('trend-chart')
    const width = 720
    const height = 158
    const left = 36
    const right = width - 16
    const top = 10
    const bottom = height - 28
    const series = [
      { key: 'all', color: 'total', get: report => report.summary?.findingCount ?? getRows(report).length },
      { key: 'P1', color: 'p1', get: report => report.summary?.findingsBySeverity?.P1 ?? 0 },
      { key: 'P2', color: 'p2', get: report => report.summary?.findingsBySeverity?.P2 ?? 0 },
    ]
    const values = items.flatMap(([, report]) => series.map(row => Number(row.get(report)) || 0))
    const max = Math.max(1, ...values)
    const xAt = index => items.length < 2 ? (left + right) / 2 : left + (right - left) * index / (items.length - 1)
    const yAt = value => bottom - (bottom - top) * value / max
    const grid = [0, .5, 1].map(ratio => {
      const y = bottom - (bottom - top) * ratio
      return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text class="chart-axis" x="${left - 9}" y="${y + 3}" text-anchor="end">${number(Math.round(max * ratio))}</text>`
    }).join('')
    const lines = series.map(row => {
      const points = items.map(([, report], index) => [xAt(index), yAt(Number(row.get(report)) || 0)])
      const path = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
      const line = points.length > 1 ? `<path class="chart-line ${row.color}" d="${path}"/>` : ''
      const circles = points.map(([x, y], index) => {
        const val = number(row.get(items[index][1]))
        const label = row.key === 'all' ? '全部信號' : row.key
        return `<circle class="chart-point ${row.color}" cx="${x}" cy="${y}" r="4"><title>${safeValue(shortDate(items[index][1].generatedAt))} ${label}: ${val}</title></circle>`
      }).join('')
      return line + circles
    }).join('')
    const labels = items.length === 1
      ? `<text class="chart-date" x="${width / 2}" y="${height - 5}" text-anchor="middle">${safeValue(shortDate(items[0][1].generatedAt))}</text>`
      : items.map(([, report], index) => {
        if (items.length > 8 && index > 0 && index < items.length - 1 && index % Math.ceil(items.length / 5) !== 0) return ''
        return `<text class="chart-date" x="${xAt(index)}" y="${height - 5}" text-anchor="middle">${safeValue(shortDate(report.generatedAt))}</text>`
      }).join('')
    node.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${items.length} 次扫描的全部、P1 和 P2 信号趋势">${grid}${lines}${labels}</svg>`
    setText('trend-caption', `${items.length} 次扫描 · 信号数量`)
  }

  function renderSeverity(report) {
    const counts = report.summary?.findingsBySeverity ?? {}
    const values = ['P1', 'P2', 'P3'].map(key => ({ key, count: Number(counts[key]) || 0 }))
    const max = Math.max(1, ...values.map(row => row.count))
    document.getElementById('severity-breakdown').innerHTML = values.map(row => `
      <div class="severity-row">
        <span class="severity-name">${row.key}</span>
        <div class="severity-track" aria-hidden="true"><div class="severity-fill ${row.key.toLowerCase()}" style="width:${row.count / max * 100}%"></div></div>
        <span class="severity-count">${number(row.count)}</span>
      </div>`).join('')
    const integrity = report.summary?.integrityCoverage ?? {}
    const unpinned = integrity.unpinned?.length ?? 0
    document.getElementById('integrity-line').innerHTML = `Integrity 固定率 <strong>${number(integrity.pinned)}/${number(integrity.total)}</strong>${unpinned ? ` · ${number(unpinned)} 项未固定` : ''}`
  }

  function renderCommits(report) {
    const comparison = report.github?.comparison
    const commits = comparison?.commits ?? []
    setText('upstream-caption', comparison ? `${comparison.aheadBy ?? 0} 个提交前进 · ${number(comparison.files?.length ?? 0)} 个文件变化` : '本次没有可用的 Git 比较数据')
    document.getElementById('commit-list').innerHTML = commits.length ? commits.map(commit => `
      <li><span class="commit-date">${safeValue(shortDate(commit.date))}</span><span class="commit-subject">${safeValue(commit.message)}<span class="commit-hash">${safeValue(text(commit.sha).slice(0, 9))}</span></span></li>`).join('') : '<li class="empty-inline">没有上游提交记录</li>'
    const sourceCopies = comparison?.sourceCopyChanges ?? []
    document.getElementById('source-copy-list').innerHTML = sourceCopies.length ? sourceCopies.map(row => `
      <div class="source-copy-row"><strong>${safeValue(row.id)}</strong><span>${number(row.files?.length ?? 0)} 个镜像文件</span></div>`).join('') : '<div class="empty-inline">未触及已登记源码镜像</div>'
    const untracked = comparison?.untrackedUpstreamPaths ?? []
    const summary = `其他上游路径 ${number(untracked.length)} 组 · ${number(comparison?.untrackedUpstreamFileCount ?? 0)} 个文件`
    setText('untracked-summary', summary)
    document.getElementById('untracked-list').innerHTML = untracked.map(row => `<li>${safeValue(row.upstreamPath)} <span class="secondary-text">${number(row.changedFileCount)} 个文件</span></li>`).join('')
    document.getElementById('untracked-details').hidden = untracked.length === 0
  }

  function impactMarkup(row) {
    const files = row.changedFiles ?? []
    const consumers = row.consumerFiles ?? []
    const impactType = row.runtimeSourceChanged ? 'runtime' : 'metadata'
    const details = [...files.map(file => `文件 · ${file}`), ...consumers.map(file => `Bay · ${file}`)]
    const firstConsumer = consumers[0] ? text(consumers[0]).split('/').at(-1) : '未发现源码导入'
    return `<tr data-type="${impactType}" data-search="${safeValue(`${row.package} ${files.join(' ')} ${consumers.join(' ')}`).toLowerCase()}">
      <td><span class="pkg-name">${safeValue(row.package)}</span></td>
      <td><span class="change-kind ${impactType}">${runtimeLabel(row)}</span></td>
      <td><span class="severity-label ${severityClass(row.runtimeSourceChanged ? (row.impact === 'P0' ? 'P1' : 'P2') : 'P2')}">${row.runtimeSourceChanged && row.impact === 'P0' ? 'P1' : 'P2'}</span></td>
      <td>${number(files.length)}</td>
      <td>${safeValue(firstConsumer)}${consumers.length > 1 ? `<span class="secondary-text">另有 ${number(consumers.length - 1)} 个</span>` : ''}</td>
      <td>${details.length ? `<details class="row-details"><summary>查看路径</summary><ul>${details.map(item => `<li>${safeValue(item)}</li>`).join('')}</ul></details>` : '<span class="secondary-text">无明细</span>'}</td>
    </tr>`
  }

  function applyImpactFilters() {
    const query = document.getElementById('impact-search').value.trim().toLowerCase()
    const filter = document.getElementById('impact-filter').value
    let visible = 0
    document.querySelectorAll('#impact-body tr').forEach(row => {
      const matchesType = filter === 'all' || row.dataset.type === filter
      const matchesQuery = !query || row.dataset.search.includes(query)
      row.hidden = !(matchesType && matchesQuery)
      if (!row.hidden) visible += 1
    })
    setText('impact-count', `${number(visible)} / ${number(document.querySelectorAll('#impact-body tr').length)} 个依赖`)
    document.getElementById('impact-empty').hidden = visible > 0
  }

  function renderImpacts(report) {
    const rows = [...getDeps(report)].sort((a, b) => Number(Boolean(b.runtimeSourceChanged)) - Number(Boolean(a.runtimeSourceChanged)) || text(a.package).localeCompare(text(b.package)))
    document.getElementById('impact-body').innerHTML = rows.map(impactMarkup).join('')
    applyImpactFilters()
  }

  function renderNpm(report) {
    const findings = getRows(report)
    const newer = findings.filter(row => row.kind === 'newer-version').sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || text(a.package).localeCompare(text(b.package)))
    const peerByName = new Map(findings.filter(row => row.kind === 'peer-contract-drift').map(row => [row.package, row]))
    const exportsByName = new Set(findings.filter(row => row.kind === 'exports-drift').map(row => row.package))
    setText('npm-caption', `${number(newer.length)} 个包有较新版本 · ${number(report.npm?.packages?.length ?? 0)} 项 Registry 元数据已读取`)
    document.getElementById('npm-body').innerHTML = newer.map(row => {
      const peer = peerByName.get(row.package)
      const peerText = peer ? `${number(peer.changes?.length ?? 0)} 项 Peer 变化` : exportsByName.has(row.package) ? 'Exports 变化' : '契约未见变化'
      return `<tr data-search="${safeValue(`${row.package} ${row.baselineVersion} ${row.latestVersion}`).toLowerCase()}">
        <td><span class="pkg-name">${safeValue(row.package)}</span></td>
        <td class="version">${safeValue(row.baselineVersion)}</td>
        <td class="version version-new">${safeValue(row.latestVersion)}</td>
        <td class="contract-changes">${safeValue(peerText)}</td>
        <td><span class="severity-label ${severityClass(row.severity)}">${safeValue(row.severity)}</span></td>
      </tr>`
    }).join('')
    document.getElementById('npm-empty').hidden = newer.length > 0
    const peers = findings.filter(row => row.kind === 'peer-contract-drift')
    document.getElementById('peer-list').innerHTML = peers.length ? peers.map(row => {
      const changes = (row.changes ?? []).map(change => `${change.name}: ${change.baseline ?? '无'} → ${change.latest ?? '无'}`).join('；')
      return `<article class="peer-row"><strong>${safeValue(row.package)}</strong><span>${safeValue(changes || '契约发生变化')}</span></article>`
    }).join('') : '<div class="empty-inline">没有 Peer 契约变化</div>'
  }

  function applyNpmFilter() {
    const query = document.getElementById('npm-search').value.trim().toLowerCase()
    let visible = 0
    document.querySelectorAll('#npm-body tr').forEach(row => {
      row.hidden = Boolean(query && !row.dataset.search.includes(query))
      if (!row.hidden) visible += 1
    })
    document.getElementById('npm-empty').hidden = visible > 0
  }

  function renderHistory(items) {
    const rows = items.slice().reverse()
    setText('history-caption', `${number(rows.length)} 次可用扫描 · 选择顶部快照可查看单次报告`)
    document.getElementById('history-body').innerHTML = rows.map(([, report]) => {
      const counts = report.summary?.findingsBySeverity ?? {}
      return `<tr>
        <td>${safeValue(dateTime(report.generatedAt))}</td>
        <td class="version">${safeValue(report.github?.latestTag ?? '不可用')}</td>
        <td>${number(report.github?.comparison?.aheadBy ?? 0)}</td>
        <td>${number(report.github?.comparison?.files?.length ?? 0)}</td>
        <td>${number(report.summary?.findingCount ?? getRows(report).length)}</td>
        <td><span class="severity-text-p1">${number(counts.P1 ?? 0)}</span> / <span class="severity-text-p2">${number(counts.P2 ?? 0)}</span></td>
      </tr>`
    }).join('')
  }

  function render() {
    const report = byId.get(selectedId)
    if (!report) {
      setText('report-subtitle', '没有可显示的扫描报告')
      return
    }
    const items = latestReports()
    const comparison = report.github?.comparison
    const fetchStatus = report.github?.fetch
    document.title = `DSH Bay | ${report.github?.latestTag ?? '扫描报告'} 依赖漂移`
    setText('report-subtitle', `${report.baseline?.candidate ?? 'DSH Bay'} · 生成于 ${dateTime(report.generatedAt)}`)
    const status = document.getElementById('scan-status')
    status.textContent = statusLabel(report.status)
    status.dataset.state = statusTone(report.status)
    setText('bay-version', report.baseline?.candidate ?? '—')
    setText('baseline-tag', report.github?.baselineTag ?? report.baseline?.upstreamTag ?? '—')
    setText('latest-tag', report.github?.latestTag ?? '—')
    const fetchText = fetchStatus?.status === 'passed' ? `Git tags 已刷新 · ${number(fetchStatus.tagCount)} 个 tags` : fetchStatus?.cachedMirrorUsed ? '使用本地 mirror · 远端拉取未完成' : 'Git 拉取状态未知'
    setText('fetch-status', `${fetchText} · npm ${report.npm?.status === 'complete' ? '完整' : report.npm?.status ?? '未查询'}`)
    setText('metric-commits', number(comparison?.aheadBy ?? 0))
    setText('metric-files', number(comparison?.files?.length ?? 0))
    setText('metric-files-note', comparison?.filesTruncated ? '文件清单有截断' : '完整文件清单')
    const deps = getDeps(report)
    setText('metric-dependencies', number(deps.length))
    setText('metric-dependencies-note', `${number(deps.filter(row => row.runtimeSourceChanged).length)} 个包含运行时代码变化`)
    const findingCount = report.summary?.findingCount ?? getRows(report).length
    const counts = report.summary?.findingsBySeverity ?? {}
    setText('metric-findings', number(findingCount))
    setText('metric-findings-note', `${number(counts.P1 ?? 0)} 个 P1 · ${number(counts.P2 ?? 0)} 个 P2`)
    renderSeverity(report)
    renderCommits(report)
    renderImpacts(report)
    renderNpm(report)
    renderHistory(items)
    renderTrend(items)
    setText('footer-meta', `${report.github?.latestCommit?.slice(0, 12) ?? '无 commit'} · ${report.mode ?? 'unknown'}`)
    applyNpmFilter()
  }

  document.getElementById('report-select').addEventListener('change', event => {
    selectedId = event.target.value
    render()
  })
  document.getElementById('impact-search').addEventListener('input', applyImpactFilters)
  document.getElementById('impact-filter').addEventListener('change', applyImpactFilters)
  document.getElementById('npm-search').addEventListener('input', applyNpmFilter)
  document.getElementById('report-import').addEventListener('change', async event => {
    const files = [...(event.target.files ?? [])]
    let added = 0
    const errors = []
    for (const file of files) {
      try {
        const report = JSON.parse(await file.text())
        if (addReport(report)) added += 1
        else errors.push(file.name)
      } catch { errors.push(file.name) }
    }
    fillSelect()
    render()
    toast(added ? `已载入 ${added} 份报告${errors.length ? `，跳过 ${errors.length} 份无效或重复文件` : ''}` : '未载入新报告，请选择有效的扫描 JSON')
    event.target.value = ''
  })

  fillSelect()
  render()
})()
