/**
 * 静态演示版 API 适配层。
 *
 * 把原先由 FastAPI 提供的接口，在浏览器内存中重建：
 * 检测/脱敏走真实规则引擎（demo-rules.js），记录、统计、决策链路与真实后端保持一致。
 * 不发起任何网络请求，数据不离开本机。
 */
(function () {
  'use strict';

  const R = window.DemoRules;
  const D = window.DemoData;
  if (!R || !D) {
    console.error('[demo] demo-rules.js / demo-data.js 未加载');
    return;
  }

  /* ================= 基础工具 ================= */

  const NOW = new Date();
  const pad = (n) => String(n).padStart(2, '0');

  function atOffset(daysAgo, hour, minute) {
    const d = new Date(NOW);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour || 0, minute || 0, 0, 0);
    return d;
  }

  const isoOf = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  let seq = 0;
  const uid = (prefix) => {
    seq += 1;
    const rnd = Math.random().toString(16).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${rnd.slice(0, 4)}`;
  };

  const jsonResponse = (data, status) =>
    new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const fail = (detail, status) => jsonResponse({ detail }, status || 400);

  const clone = (v) => JSON.parse(JSON.stringify(v));

  /* ================= 检测记录状态 ================= */

  const records = [];

  // 演示账号与种子数据里的归属关系：记录按 owner 字段控制可见范围
  const SEED_OWNERS = [
    { id: 'demo-student', department: '计算机学院' },
    { id: 'demo-teacher', department: '计算机学院' },
    { id: 'demo-admin', department: '信息中心' },
    { id: 'user-student-wang', department: '外国语学院' },
    { id: 'user-student-li', department: '艺术设计学院' },
  ];

  function pushRecord(result, textLength, createdAt, owner) {
    const level = R.riskLevel(result.risk_score);
    const record = {
      id: uid('rec'),
      module: result.module,
      inspection_target: result.inspection_target,
      safe: result.safe,
      risk_level: level,
      risk_score: result.risk_score,
      provider: result.provider,
      findings: result.findings,
      sanitized_text: result.sanitized_text || null,
      warnings: result.warnings || [],
      elapsed_ms: result.elapsed_ms,
      input_length: textLength,
      owner_id: owner ? owner.id : actor().id,
      owner_department: owner ? owner.department : actor().department,
      created_at: isoOf(createdAt || new Date()),
    };
    records.unshift(record);
    return record;
  }

  // 种子记录：用真实规则引擎现场计算，保证 findings 与规则一致
  D.seedDetections.forEach((seed, index) => {
    const result =
      seed.module === 'privacy'
        ? R.detectPrivacy(seed.text, 'placeholder')
        : R.detectContent(seed.text, seed.target);
    if (seed.module === 'privacy') result.inspection_target = 'input';
    pushRecord(
      result,
      seed.text.length,
      atOffset(seed.days_ago, seed.hour, seed.minute),
      SEED_OWNERS[index % SEED_OWNERS.length],
    );
  });

  records.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  function filterRecords(params) {
    let list = visibleRecords().slice();
    const module = params.get('module');
    const level = params.get('level');
    const startedAt = params.get('started_at');
    const endedAt = params.get('ended_at');

    if (module) list = list.filter((r) => r.module === module);
    if (level) {
      if (level === 'high') list = list.filter((r) => r.risk_score >= 80);
      else if (level === 'medium')
        list = list.filter((r) => r.risk_score >= 50 && r.risk_score <= 79);
      else if (level === 'low')
        list = list.filter((r) => r.risk_score >= 1 && r.risk_score <= 49);
      else if (level === 'safe') list = list.filter((r) => r.risk_score === 0);
    }
    if (startedAt) list = list.filter((r) => r.created_at >= startedAt);
    if (endedAt) list = list.filter((r) => r.created_at <= endedAt);
    return list;
  }

  function recordsPage(params) {
    const list = filterRecords(params);
    const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
    const size = Math.max(1, parseInt(params.get('page_size') || '20', 10) || 20);
    const start = (page - 1) * size;
    return {
      items: list.slice(start, start + size),
      total: list.length,
      page,
      page_size: size,
    };
  }

  function recordsStats() {
    const scoped = visibleRecords();
    const todayKey = dayKey(NOW);
    const modules = { content: 0, privacy: 0 };
    const categoryMap = new Map();

    scoped.forEach((r) => {
      modules[r.module] = (modules[r.module] || 0) + 1;
      (r.findings || []).forEach((f) => {
        categoryMap.set(f.category, (categoryMap.get(f.category) || 0) + 1);
      });
    });

    const trend = [];
    for (let i = 6; i >= 0; i -= 1) {
      const key = dayKey(atOffset(i, 12, 0));
      trend.push({
        date: key,
        count: scoped.filter((r) => dayKey(new Date(r.created_at)) === key).length,
      });
    }

    return {
      total: scoped.length,
      safe: scoped.filter((r) => r.risk_score === 0).length,
      low: scoped.filter((r) => r.risk_score >= 1 && r.risk_score <= 49).length,
      medium: scoped.filter((r) => r.risk_score >= 50 && r.risk_score <= 79).length,
      high: scoped.filter((r) => r.risk_score >= 80).length,
      today: scoped.filter((r) => dayKey(new Date(r.created_at)) === todayKey).length,
      modules,
      trend,
      categories: Array.from(categoryMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      recent: scoped.slice(0, 5),
    };
  }

  /* ================= 网关状态 ================= */

  const state = {
    events: clone(D.gatewayEvents).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    conversations: clone(D.conversations),
    usage: { today_used: 0, daily_limit: 300, minute_used: 0, minute_limit: 6 },
    users: clone(D.users),
    llmProfiles: clone(D.llmProfiles),
    knowledge: clone(D.knowledge),
    learningPlans: clone(D.learningPlans),
    learningTasks: clone(D.learningTasks),
    wrongQuestions: clone(D.wrongQuestions),
    evaluationHistory: clone(D.evaluationHistory),
    evaluationRuns: {},
    alerts: clone(D.monitoringAlerts),
  };

  /* ================= 演示账号与会话 ================= */

  const SESSION_KEY = 'campus-demo-session';

  // 静态演示版内置三组账号，覆盖管理员 / 教师 / 学生三种可见范围
  const DEMO_ACCOUNTS = [
    {
      username: 'admin',
      password: 'admin123',
      id: 'demo-admin',
      display_name: '平台管理员',
      role: 'admin',
      department: '信息中心',
    },
    {
      username: 'teacher',
      password: 'teacher123',
      id: 'demo-teacher',
      display_name: '李老师',
      role: 'teacher',
      department: '计算机学院',
    },
    {
      username: 'student',
      password: 'student123',
      id: 'demo-student',
      display_name: '张同学',
      role: 'student',
      department: '计算机学院',
    },
  ];

  const ROLE_DAILY_LIMIT = { admin: 300, teacher: 100, student: 30 };

  function readSession() {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeSession(user) {
    try {
      if (user) {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      } else {
        window.localStorage.removeItem(SESSION_KEY);
      }
    } catch {
      /* 隐私模式下忽略持久化失败 */
    }
  }

  function currentUser() {
    const session = readSession();
    if (!session) return null;
    return { ...session, authenticated: true, local_mode: false };
  }

  function actor() {
    return (
      currentUser() || {
        username: 'guest',
        role: 'guest',
        department: null,
        display_name: '未登录用户',
      }
    );
  }

  /**
   * 与后端一致的数据可见范围：
   * 管理员看全部；教师看自己 + 同部门；学生只看自己。
   */
  function visibleEvents() {
    const user = actor();
    if (user.role === 'admin') return state.events;
    if (user.role === 'teacher') {
      return state.events.filter(
        (event) =>
          event.actor_id === user.id ||
          (Boolean(user.department) && event.actor_department === user.department),
      );
    }
    return state.events.filter((event) => event.actor_id === user.id);
  }

  function visibleRecords() {
    const user = actor();
    if (user.role === 'admin') return records;
    if (user.role === 'teacher') {
      return records.filter(
        (record) =>
          record.owner_id === user.id ||
          (Boolean(user.department) && record.owner_department === user.department),
      );
    }
    return records.filter((record) => record.owner_id === user.id);
  }

  /* ================= 网关对话 ================= */

  const BLOCKED_REPLY = {
    自伤风险:
      '该内容涉及自伤或轻生风险，校园 AI 网关已阻止继续处理。如果你或身边的人正面临紧急危险，请立即联系辅导员、校园保卫处、学校心理支持服务或当地急救服务，不要独自面对。',
    学术诚信:
      '该请求涉及直接获取作业、论文或考试答案，校园 AI 网关已阻止处理。我可以帮助你分析题目、解释思路、检查步骤或指出错误，但不能代替你完成作业或提供可直接提交的答案。',
  };

  function blockedReply(categories) {
    for (const cat of ['自伤风险', '学术诚信']) {
      if (categories.indexOf(cat) > -1) return BLOCKED_REPLY[cat];
    }
    const text = categories.join('、');
    return (
      '该请求未通过校园 AI 安全检查，已被拦截。' +
      (text ? `风险类别：${text}。` : '') +
      '请调整表达后重试，或联系管理员了解具体策略。'
    );
  }

  function searchKnowledge(text) {
    const scored = state.knowledge
      .filter((k) => k.is_active)
      .map((item) => {
        let score = 0;
        item.keywords.forEach((kw) => {
          if (kw && text.indexOf(kw) > -1) score += 3;
        });
        // 标题里出现的连续两字也计分，覆盖关键词之外的表述
        const title = item.title;
        for (let i = 0; i < title.length - 1; i += 1) {
          const gram = title.slice(i, i + 2);
          if (/^[\u4e00-\u9fff]{2}$/.test(gram) && text.indexOf(gram) > -1) score += 1;
        }
        if (text.indexOf(item.category) > -1) score += 1;
        return { item, score };
      })
      .filter((x) => x.score >= 3)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 2).map((x) => x.item);
  }

  function genericReply(question) {
    const analysis = R.analyzeQuestion(question);
    if (analysis.subject === 'Python') {
      return [
        '这是演示环境的本地应答（未接入外部大模型）。就这个 Python 问题，建议按下面的顺序推进：',
        '',
        '1. 先孤立最小复现：把无关代码去掉，只留下真正出问题的几行。',
        '2. 打印中间状态：在关键位置输出变量的类型和值，注意列表、字典是可变对象，赋值只复制引用。',
        '3. 对照官方文档确认函数签名和返回值，尤其是索引区间与是否原地修改。',
        '',
        `本题涉及的知识点：${analysis.knowledge_points.join('、')}。`,
      ].join('\n');
    }
    if (analysis.subject === '数学') {
      return [
        '这是演示环境的本地应答（未接入外部大模型）。这类题可以按以下步骤处理：',
        '',
        '1. 把已知条件逐条写成分式或等式，标出未知量。',
        '2. 判断它属于哪种标准题型，优先尝试对应的固定解法。',
        '3. 每步变形后回看是否等价，特别是两边乘除、开方、取对数时。',
        '4. 结果代回原式验证。',
        '',
        `本题涉及的知识点：${analysis.knowledge_points.join('、')}。如果用「分步讲解」模式，我可以给出更细的步骤。`,
      ].join('\n');
    }
    return [
      '这是演示环境的本地应答（未接入外部大模型，校园知识库也没有直接匹配的条目）。',
      '',
      '已完成的网关检查：',
      `· 内容安全：未命中风险规则（风险分 0）`,
      `· 隐私识别：未发现敏感实体`,
      `· 决策：放行`,
      '',
      `关于「${question.slice(0, 40)}」，建议把问题拆成更具体的小问题，或换成校园事务类问题（图书馆、选课、宿舍报修、考试纪律），这些在本地知识库里有可核验的资料条目。`,
    ].join('\n');
  }

  function composeReply(question, sources) {
    if (sources.length === 0) return genericReply(question);
    const main = sources[0];
    return [
      `根据校园知识库「${main.title}」：`,
      '',
      main.content,
      '',
      `来源：${main.source_title}${main.version ? `（v${main.version}）` : ''}`,
    ].join('\n');
  }

  function handleChat(body) {
    const started = performance.now();
    const message = String(body.message || '');
    const attachmentText = body.attachment_text ? String(body.attachment_text) : null;
    const combined = attachmentText ? `${message}\n${attachmentText}` : message;

    const content = R.detectContent(combined, 'input');
    const privacy = R.detectPrivacy(combined, 'placeholder');

    const categories = Array.from(
      new Set([
        ...content.findings.map((f) => f.category),
        ...privacy.findings.map((f) => f.category),
      ]),
    );

    const hasBlockingSeverity = content.findings.some(
      (f) => f.severity === 'high' || f.severity === 'critical',
    );
    const blocked = content.risk_score >= 80 || hasBlockingSeverity;
    const redactedQuestion = privacy.sanitized_text;

    let decision = 'allow';
    let reply = '';
    let sources = [];
    let groundingStatus = 'not_applicable';
    let reviewRequired = false;

    if (blocked) {
      decision = 'block';
      reply = blockedReply(categories);
      reviewRequired = true;
    } else {
      if (privacy.findings.length > 0) decision = 'redact';
      else if (content.risk_score >= 50) {
        decision = 'review';
        reviewRequired = true;
      }

      const matched = attachmentText ? [] : searchKnowledge(redactedQuestion);
      sources = matched.map((k) => ({
        source_id: k.id,
        title: k.title,
        url: k.source_url || null,
        verified_at: k.verified_at || isoOf(NOW),
        excerpt: k.content.slice(0, 80),
      }));
      groundingStatus = sources.length > 0 ? 'grounded' : 'not_applicable';
      reply = composeReply(redactedQuestion, matched);
    }

    // 会话
    let conversationId = body.conversation_id;
    let conversation = state.conversations.find((c) => c.conversation.id === conversationId);
    if (!conversation) {
      conversationId = uid('conv');
      conversation = {
        conversation: {
          id: conversationId,
          title: (redactedQuestion || '新对话').slice(0, 40),
          created_at: isoOf(new Date()),
          updated_at: isoOf(new Date()),
        },
        messages: [],
      };
      state.conversations.unshift(conversation);
    }
    conversation.messages.push({
      id: uid('msg'),
      role: 'user',
      content: redactedQuestion,
      attachment_name: body.attachment_name || null,
      decision,
      created_at: isoOf(new Date()),
    });
    conversation.messages.push({
      id: uid('msg'),
      role: 'assistant',
      content: reply,
      attachment_name: null,
      decision,
      created_at: isoOf(new Date()),
    });
    conversation.conversation.updated_at = isoOf(new Date());

    const elapsed = Math.max(28, Math.round(performance.now() - started));

    // 审计事件
    const event = {
      id: uid('evt'),
      actor_username: actor().username,
      actor_id: actor().id,
      actor_role: actor().role,
      actor_department: actor().department,
      conversation_id: conversationId,
      model: 'deepseek-chat',
      input_length: combined.length,
      input_risk_score: content.risk_score,
      input_categories: Array.from(new Set(content.findings.map((f) => f.category))),
      input_redacted: privacy.findings.length > 0,
      decision,
      policy_reason:
        decision === 'block'
          ? `用户输入触发高风险策略：${Array.from(new Set(content.findings.map((f) => f.category))).join('、')}`
          : decision === 'redact'
            ? `用户输入命中隐私实体，脱敏后放行：${Array.from(new Set(privacy.findings.map((f) => f.category))).join('、')}`
            : decision === 'review'
              ? '用户输入需要人工复核'
              : '输入与输出均未命中风险规则',
      review_required: reviewRequired,
      review_status: reviewRequired ? 'pending' : 'not_required',
      output_length: reply.length,
      output_risk_score: 0,
      output_categories: [],
      output_blocked: false,
      grounding_status: groundingStatus,
      grounding_warnings: [],
      claim_count: sources.length > 0 ? 2 : 0,
      unsupported_claim_count: 0,
      source_count: sources.length,
      sanitized_input_preview: privacy.findings.length > 0 ? redactedQuestion.slice(0, 80) : null,
      sanitized_output_preview: null,
      latency_ms: elapsed,
      reviewer_name: null,
      review_note: null,
      reviewed_at: null,
      created_at: isoOf(new Date()),
    };
    state.events.unshift(event);

    state.usage.today_used += 1;
    state.usage.minute_used += 1;

    return {
      event_id: event.id,
      conversation_id: conversationId,
      decision,
      blocked: decision === 'block',
      reply,
      review_required: reviewRequired,
      input_redacted: privacy.findings.length > 0,
      output_redacted: false,
      input_risk_score: content.risk_score,
      output_risk_score: 0,
      input_categories: categories,
      output_categories: [],
      policy_reason: event.policy_reason,
      answer_mode: decision === 'block' ? 'policy' : sources.length > 0 ? 'knowledge' : 'model',
      sources,
      grounding_status: groundingStatus,
      grounding_warnings: [],
      grounding_claims: [],
      provider_id: 'demo-local',
      model: 'demo-local-rules',
      elapsed_ms: elapsed,
    };
  }

  /* ================= 网关统计 ================= */

  function gatewayEventsPage(params) {
    let list = visibleEvents().slice();
    const decision = params.get('decision');
    const reviewStatus = params.get('review_status');
    const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
    const size = Math.max(1, parseInt(params.get('page_size') || '20', 10) || 20);
    if (decision) list = list.filter((e) => e.decision === decision);
    if (reviewStatus) list = list.filter((e) => e.review_status === reviewStatus);
    return {
      items: list.slice((page - 1) * size, (page - 1) * size + size),
      total: list.length,
      page,
      page_size: size,
    };
  }

  function gatewayStats() {
    const events = visibleEvents();
    const todayKey = dayKey(NOW);
    const categoryMap = new Map();
    events.forEach((e) => {
      (e.input_categories || []).concat(e.output_categories || []).forEach((c) => {
        categoryMap.set(c, (categoryMap.get(c) || 0) + 1);
      });
    });
    const trend = [];
    for (let i = 6; i >= 0; i -= 1) {
      const key = dayKey(atOffset(i, 12, 0));
      trend.push({
        date: key,
        count: events.filter((e) => dayKey(new Date(e.created_at)) === key).length,
      });
    }
    return {
      total: events.length,
      allowed: events.filter((e) => e.decision === 'allow').length,
      redacted: events.filter((e) => e.decision === 'redact').length,
      review: events.filter((e) => e.decision === 'review').length,
      blocked: events.filter((e) => e.decision === 'block').length,
      pending_review: events.filter((e) => e.review_status === 'pending').length,
      today: events.filter((e) => dayKey(new Date(e.created_at)) === todayKey).length,
      trend,
      categories: Array.from(categoryMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  }

  function gatewayMonitoring() {
    const events = visibleEvents();
    const since = Date.now() - 24 * 3600 * 1000;
    const recent = events.filter((e) => new Date(e.created_at).getTime() >= since);
    const blocked = recent.filter((e) => e.decision === 'block').length;
    const grounded = recent.filter((e) => e.grounding_status === 'grounded').length;
    const unverified = recent.filter((e) => e.grounding_status === 'unverified').length;
    const unsupported = recent.reduce((s, e) => s + (e.unsupported_claim_count || 0), 0);
    const latencies = recent.map((e) => e.latency_ms).sort((a, b) => a - b);
    const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;
    const blockRate = recent.length ? Number(((blocked / recent.length) * 100).toFixed(1)) : 0;
    const groundingFail = grounded + unverified > 0 ? Number(((unverified / (grounded + unverified)) * 100).toFixed(1)) : 0;

    const alerts = [];
    if (blockRate >= 20) {
      alerts.push({
        level: 'warning',
        title: '拦截率高于基线',
        detail: `最近 24 小时拦截率 ${blockRate}%，高于基线 15%，建议检查是否存在批量攻击或规则误判。`,
        metric: 'block_rate',
      });
    }
    if (unsupported > 0) {
      alerts.push({
        level: 'info',
        title: '存在未支持结论',
        detail: `检出 ${unsupported} 条回答包含资料未覆盖的结论，已标记为待复核。`,
        metric: 'unsupported_claims',
      });
    }
    if (p95 > 3000) {
      alerts.push({
        level: 'warning',
        title: '响应延迟偏高',
        detail: `P95 延迟 ${p95}ms，超过 3000ms 阈值。`,
        metric: 'p95_latency_ms',
      });
    }
    if (alerts.length === 0) {
      alerts.push({
        level: 'info',
        title: '监测状态正常',
        detail: '当前窗口内没有达到告警阈值。',
        metric: 'none',
      });
    }

    return {
      generated_at: isoOf(new Date()),
      window_hours: 24,
      requests_24h: recent.length,
      blocked_24h: blocked,
      block_rate: blockRate,
      pending_review: events.filter((e) => e.review_status === 'pending').length,
      grounded_answers: grounded,
      unverified_answers: unverified,
      grounding_failure_rate: groundingFail,
      unsupported_claims: unsupported,
      p95_latency_ms: p95,
      alerts,
    };
  }

  /* ================= 评估 ================= */

  function runEvaluation() {
    const started = Date.now();
    const cases = D.evaluationCases.map((c, i) => {
      const result = R.detectContent(c.text, 'input');
      const hit = result.findings.map((f) => f.category);
      const passed = c.expected_category
        ? hit.indexOf(c.expected_category) > -1
        : hit.length === 0;
      return {
        description: c.text,
        passed,
        output: result.findings.length
          ? `命中：${hit.join('、')}（风险分 ${result.risk_score}）`
          : '未命中风险规则',
        risk_score: result.risk_score,
        findings: hit,
        reason: passed
          ? c.expected_category
            ? `按预期命中「${c.expected_category}」`
            : '预期安全，实际未命中'
          : c.expected_category
            ? `预期命中「${c.expected_category}」，实际未命中或不符`
            : `预期安全，但误报为「${hit.join('、')}」`,
        expected_category: c.expected_category,
        index: i,
      };
    });

    const passedCount = cases.filter((c) => c.passed).length;
    const total = cases.length;
    const passRate = total ? (passedCount / total) * 100 : 0;
    const runId = uid('run');
    const now = isoOf(new Date());

    const run = {
      run_id: runId,
      suite: 'content-regression',
      status: 'completed',
      created_at: now,
      started_at: now,
      finished_at: isoOf(new Date()),
      summary: {
        total,
        passed: passedCount,
        failed: total - passedCount,
        errors: 0,
        duration_ms: Math.max(120, Date.now() - started),
      },
      cases,
      output_file: null,
      error: null,
      quality_gate_passed: passRate >= 95,
      quality_gate_reason:
        passRate >= 95
          ? `通过率 ${passRate.toFixed(1)}%，质量门禁达标`
          : `通过率 ${passRate.toFixed(1)}%，低于质量门禁阈值 95%`,
    };

    state.evaluationRuns[runId] = run;
    state.evaluationHistory.unshift({
      run_id: runId,
      suite: run.suite,
      status: run.status,
      owner_name: '本地管理员',
      created_at: now,
      started_at: run.started_at,
      finished_at: run.finished_at,
      summary: run.summary,
      quality_gate_passed: run.quality_gate_passed,
      quality_gate_reason: run.quality_gate_reason,
      error: null,
      output_file: null,
    });
    return run;
  }

  /* ================= 文档脱敏与 DOCX 导出 ================= */

  async function readFileText(file) {
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.docx')) {
      // docx 本质是 zip，静态版直接抽取正文文本：去掉标签后保留可读内容
      const buf = await file.arrayBuffer();
      const text = extractDocxText(buf);
      if (text) return text;
    }
    return await file.text();
  }

  function extractDocxText(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      const decoder = new TextDecoder('utf-8');
      let raw = '';
      for (let i = 0; i < bytes.length; i += 1) raw += String.fromCharCode(bytes[i]);
      // 直接在整个 zip 里找 document.xml 片段：<w:t> 文本节点
      const pieces = [];
      const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let m;
      while ((m = re.exec(raw)) !== null) pieces.push(m[1]);
      if (pieces.length === 0) return '';
      return pieces.join('').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    } catch {
      return '';
    }
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStore(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime =
      ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() / 2) & 0x1f);
    const dosDate =
      (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);

    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
    const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

    files.forEach((f) => {
      const nameBytes = encoder.encode(f.name);
      const data = encoder.encode(f.content);
      const crc = crc32(data);

      const local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0),
        u16(dosTime), u16(dosDate), u32(crc),
        u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0),
      );
      chunks.push(new Uint8Array(local), nameBytes, data);

      central.push({ nameBytes, crc, size: data.length, offset });
      offset += local.length + nameBytes.length + data.length;
    });

    const cenChunks = [];
    let cenSize = 0;
    central.forEach((c) => {
      const head = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
        u16(dosTime), u16(dosDate), u32(c.crc),
        u32(c.size), u32(c.size),
        u16(c.nameBytes.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(c.offset),
      );
      cenChunks.push(new Uint8Array(head), c.nameBytes);
      cenSize += head.length + c.nameBytes.length;
    });

    const eocd = new Uint8Array(
      [].concat(
        u32(0x06054b50), u16(0), u16(0),
        u16(files.length), u16(files.length),
        u32(cenSize), u32(offset), u16(0),
      ),
    );

    const all = chunks.concat(cenChunks, [eocd]);
    const total = all.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    all.forEach((c) => {
      out.set(c, pos);
      pos += c.length;
    });
    return out;
  }

  const escapeXml = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function buildDocx(text) {
    const paragraphs = text.split(/\r?\n/).map((line) => {
      const run = line
        ? `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`
        : '';
      return `<w:p><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr>${run}</w:p>`;
    });

    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';

    const rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';

    return zipStore([
      { name: '[Content_Types].xml', content: contentTypes },
      { name: '_rels/.rels', content: rels },
      { name: 'word/document.xml', content: documentXml },
    ]);
  }

  /* ================= 请求路由 ================= */

  function detectHandler(body, isPrivacy, params) {
    const text = String(body.text || '');
    if (!text.trim()) return fail('文本不能为空', 422);
    const result = isPrivacy
      ? R.detectPrivacy(text, body.masking_style || 'placeholder')
      : R.detectContent(text, body.inspection_target || 'input');
    if (isPrivacy) result.inspection_target = 'input';
    const record = pushRecord(result, text.length, new Date());
    return jsonResponse({ ...result, record_id: record.id });
  }

  function route(method, rawPath, params, body) {
    const path = rawPath.replace(/\/$/, '');

    /* ---- 基础 ---- */
    if (method === 'GET' && path === '/api/health') {
      return jsonResponse({ status: 'ok', service: 'campus-ai-security-gateway', version: 'demo' });
    }
    if (method === 'GET' && path === '/api/auth/status') {
      const user = currentUser();
      return jsonResponse({
        auth_required: true,
        needs_setup: false,
        authenticated: Boolean(user),
        user,
        llm_provider_id: 'demo-local',
        llm_configured: true,
        llm_profile_name: '本地演示应答',
      });
    }
    if (method === 'POST' && path === '/api/auth/login') {
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const account = DEMO_ACCOUNTS.find(
        (item) => item.username === username && item.password === password,
      );
      if (!account) {
        return fail('用户名或密码错误，请使用页面上的演示账号登录', 401);
      }
      const user = {
        id: account.id,
        username: account.username,
        display_name: account.display_name,
        role: account.role,
        department: account.department,
      };
      writeSession(user);
      return jsonResponse({
        authenticated: true,
        user: { ...user, authenticated: true, local_mode: false },
      });
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      writeSession(null);
      return jsonResponse({ authenticated: false, user: null });
    }
    if (method === 'POST' && path === '/api/auth/setup') {
      return fail('演示环境已内置账号，无需初始化管理员', 400);
    }

    /* ---- 检测 ---- */
    if (path === '/api/detection/plugins' && method === 'GET') return jsonResponse(D.plugins);
    if (path === '/api/detection/content' && method === 'POST') return detectHandler(body, false);
    if (path === '/api/detection/privacy' && method === 'POST') {
      const style = body.masking_style || 'placeholder';
      if (['placeholder', 'mask'].indexOf(style) === -1) return fail('不支持的脱敏样式', 422);
      return detectHandler(body, true);
    }

    /* ---- 记录 ---- */
    if (path === '/api/records' && method === 'GET') return jsonResponse(recordsPage(params));
    if (path === '/api/records/stats' && method === 'GET') return jsonResponse(recordsStats());
    if (path === '/api/records/export' && method === 'GET') {
      const list = filterRecords(params);
      const header = '创建时间,模块,检测目标,风险等级,风险分,风险类别,输入长度,耗时ms\n';
      const body_ = list
        .map((r) => {
          const cats = Array.from(new Set((r.findings || []).map((f) => f.category))).join('|');
          return [r.created_at, r.module, r.inspection_target, r.risk_level, r.risk_score, cats, r.input_length, r.elapsed_ms]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(',');
        })
        .join('\n');
      return new Response('\ufeff' + header + body_, {
        status: 200,
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      });
    }
    if (path.startsWith('/api/records/') && method === 'GET') {
      const id = path.split('/').pop();
      const found = visibleRecords().find((r) => r.id === id);
      return found ? jsonResponse(found) : fail('记录不存在', 404);
    }

    /* ---- 网关 ---- */
    if (path === '/api/gateway/models' && method === 'GET') return jsonResponse(D.models);
    if (path === '/api/gateway/chat' && method === 'POST') {
      if (!String(body.message || '').trim()) return fail('消息不能为空', 422);
      return jsonResponse(handleChat(body));
    }
    if (path === '/api/gateway/events' && method === 'GET') return jsonResponse(gatewayEventsPage(params));
    if (/^\/api\/gateway\/events\/[^/]+\/review$/.test(path) && method === 'PATCH') {
      if (actor().role === 'student') return fail('学生账号没有事件复核权限', 403);
      const id = path.split('/')[4];
      const ev = visibleEvents().find((e) => e.id === id);
      if (!ev) return fail('事件不存在', 404);
      ev.review_status = body.status;
      ev.review_note = body.note || null;
      ev.reviewer_name = actor().display_name;
      ev.reviewed_at = isoOf(new Date());
      ev.review_required = false;
      return jsonResponse(ev);
    }
    if (/^\/api\/gateway\/events\/[^/]+$/.test(path) && method === 'GET') {
      const id = path.split('/').pop();
      const ev = visibleEvents().find((e) => e.id === id);
      return ev ? jsonResponse(ev) : fail('事件不存在', 404);
    }
    if (path === '/api/gateway/stats' && method === 'GET') return jsonResponse(gatewayStats());
    if (path === '/api/gateway/monitoring' && method === 'GET') return jsonResponse(gatewayMonitoring());
    if (path === '/api/gateway/monitoring/alerts' && method === 'GET') return jsonResponse(state.alerts);
    if (/^\/api\/gateway\/monitoring\/alerts\/[^/]+$/.test(path) && method === 'PATCH') {
      const id = path.split('/').pop();
      const alert = state.alerts.find((a) => a.id === id);
      if (!alert) return fail('告警不存在', 404);
      alert.status = body.status;
      alert.note = body.note || alert.note;
      if (body.status === 'acknowledged') {
        alert.acknowledged_by_name = actor().display_name;
        alert.acknowledged_at = isoOf(new Date());
      } else {
        alert.resolved_at = isoOf(new Date());
      }
      return jsonResponse(alert);
    }
    if (path === '/api/gateway/usage' && method === 'GET') {
      // 不同角色的每日配额与真实后端一致
      state.usage.daily_limit = ROLE_DAILY_LIMIT[actor().role] || 30;
      return jsonResponse(state.usage);
    }
    if (path === '/api/gateway/conversations' && method === 'GET') {
      return jsonResponse(state.conversations.map((c) => c.conversation));
    }
    if (/^\/api\/gateway\/conversations\/[^/]+$/.test(path)) {
      const id = path.split('/').pop();
      const found = state.conversations.find((c) => c.conversation.id === id);
      if (!found) return fail('会话不存在', 404);
      if (method === 'DELETE') {
        state.conversations = state.conversations.filter((c) => c.conversation.id !== id);
        return new Response(null, { status: 204 });
      }
      return jsonResponse(clone(found));
    }

    /* ---- 系统 ---- */
    if (path === '/api/system/overview' && method === 'GET') return jsonResponse(D.overview);
    if (path === '/api/system/users' && method === 'GET') return jsonResponse(state.users);
    if (path === '/api/system/users' && method === 'POST') {
      const user = {
        id: uid('usr'),
        username: body.username,
        display_name: body.display_name || body.username,
        role: body.role || 'student',
        department: body.department || null,
        authenticated: false,
        local_mode: false,
        email: body.email || null,
        last_login_at: null,
        created_at: isoOf(new Date()),
      };
      state.users.push(user);
      return jsonResponse(user);
    }
    if (/^\/api\/system\/users\/[^/]+$/.test(path) && method === 'PATCH') {
      const id = path.split('/').pop();
      const user = state.users.find((u) => u.id === id);
      if (!user) return fail('用户不存在', 404);
      Object.assign(user, body);
      return jsonResponse(user);
    }
    if (path === '/api/system/llm-profiles' && method === 'GET') return jsonResponse(state.llmProfiles);
    if (path === '/api/system/llm-profiles' && method === 'POST') {
      const profile = {
        id: uid('prof'),
        name: body.name,
        provider_id: body.provider_id,
        provider_label: body.provider_id,
        model: body.provider_id,
        key_hint: 'sk-****' + String(body.api_key || '').slice(-4),
        is_active: !!body.activate,
        created_by_name: actor().display_name,
        created_at: isoOf(new Date()),
        updated_at: isoOf(new Date()),
        last_used_at: null,
      };
      if (profile.is_active) state.llmProfiles.forEach((p) => (p.is_active = false));
      state.llmProfiles.push(profile);
      return jsonResponse(profile);
    }
    if (/^\/api\/system\/llm-profiles\/[^/]+\/(activate|deactivate|test)$/.test(path)) {
      const parts = path.split('/');
      const id = parts[5];
      const action = parts[6];
      const profile = state.llmProfiles.find((p) => p.id === id);
      if (!profile) return fail('配置不存在', 404);
      if (action === 'activate') {
        state.llmProfiles.forEach((p) => (p.is_active = false));
        profile.is_active = true;
        profile.updated_at = isoOf(new Date());
        return jsonResponse(profile);
      }
      if (action === 'deactivate') {
        profile.is_active = false;
        profile.updated_at = isoOf(new Date());
        return jsonResponse(profile);
      }
      return jsonResponse({
        ok: true,
        model: profile.model,
        latency_ms: 380,
        message: '演示环境使用本地应答，未真实调用外部模型接口。',
      });
    }
    if (/^\/api\/system\/llm-profiles\/[^/]+$/.test(path)) {
      const id = path.split('/').pop();
      const idx = state.llmProfiles.findIndex((p) => p.id === id);
      if (idx === -1) return fail('配置不存在', 404);
      if (method === 'DELETE') {
        state.llmProfiles.splice(idx, 1);
        return new Response(null, { status: 204 });
      }
      Object.assign(state.llmProfiles[idx], body, { updated_at: isoOf(new Date()) });
      return jsonResponse(state.llmProfiles[idx]);
    }
    if (path === '/api/system/knowledge' && method === 'GET') {
      const subject = params.get('subject');
      const category = params.get('category');
      const keyword = params.get('keyword');
      let list = state.knowledge.slice();
      if (subject) list = list.filter((k) => k.subject === subject);
      if (category) list = list.filter((k) => k.category === category);
      if (keyword) list = list.filter((k) => (k.title + k.content).indexOf(keyword) > -1);
      return jsonResponse(list);
    }
    if (path === '/api/system/knowledge' && method === 'POST') {
      const entry = {
        id: uid('kb'),
        title: body.title,
        subject: body.subject || '通用',
        category: body.category,
        pack_name: body.pack_name || null,
        license: body.license || null,
        version: body.version || null,
        content: body.content,
        keywords: body.keywords || [],
        source_title: body.source_title,
        source_url: body.source_url || null,
        verified_at: body.verified_at || null,
        is_active: body.is_active !== false,
        created_by_name: actor().display_name,
        created_at: isoOf(new Date()),
        updated_at: isoOf(new Date()),
      };
      state.knowledge.unshift(entry);
      return jsonResponse(entry);
    }
    if (path === '/api/system/knowledge/import-pack' && method === 'POST') {
      return jsonResponse({ imported: 0, pack_name: body.pack_name, detail: '演示环境未附带资料包文件。' });
    }
    if (/^\/api\/system\/knowledge\/[^/]+$/.test(path)) {
      const id = path.split('/').pop();
      const idx = state.knowledge.findIndex((k) => k.id === id);
      if (idx === -1) return fail('条目不存在', 404);
      if (method === 'DELETE') {
        state.knowledge.splice(idx, 1);
        return new Response(null, { status: 204 });
      }
      Object.assign(state.knowledge[idx], body, { updated_at: isoOf(new Date()) });
      return jsonResponse(state.knowledge[idx]);
    }
    if (path === '/api/trust/matrix' && method === 'GET') return jsonResponse(D.trustMatrix);

    /* ---- 评估 ---- */
    if (path === '/api/evaluation/capabilities' && method === 'GET') {
      return jsonResponse({
        enabled: true,
        available: true,
        suite: 'content-regression',
        detail: '浏览器内规则回归：用例在本机执行，结果与内置规则库一致',
      });
    }
    if (path === '/api/evaluation/history' && method === 'GET') return jsonResponse(state.evaluationHistory);
    if (path === '/api/evaluation/runs' && method === 'POST') return jsonResponse(runEvaluation());
    if (/^\/api\/evaluation\/runs\/[^/]+$/.test(path) && method === 'GET') {
      const id = path.split('/').pop();
      const run = state.evaluationRuns[id];
      return run ? jsonResponse(run) : fail('评测任务不存在', 404);
    }

    /* ---- 隐私文档 ---- */
    if (path === '/api/privacy/documents/inspect' && method === 'POST') {
      const file = body && body.__file__;
      if (!file) return fail('请上传文档', 422);
      return '';
    }
    if (path === '/api/privacy/documents/export-docx' && method === 'POST') {
      const bytes = buildDocx(String(body.text || ''));
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      });
    }

    /* ---- 学习 ---- */
    if (path === '/api/learning/plans' && method === 'GET') return jsonResponse(state.learningPlans);
    if (path === '/api/learning/plans' && method === 'POST') {
      const topics = body.topics || [];
      const plan = {
        id: uid('plan'),
        objective: body.objective,
        level: body.level || 'beginner',
        topics,
        start_date: body.start_date,
        end_date: body.end_date,
        daily_minutes: body.daily_minutes || 60,
        status: 'active',
        total_tasks: topics.length * 3,
        completed_tasks: 0,
        created_at: isoOf(new Date()),
        updated_at: isoOf(new Date()),
      };
      state.learningPlans.unshift(plan);
      return jsonResponse(plan);
    }
    if (/^\/api\/learning\/plans\/tasks\/[^/]+$/.test(path) && method === 'PATCH') {
      const id = path.split('/').pop();
      const task = state.learningTasks.find((t) => t.id === id);
      if (!task) return fail('任务不存在', 404);
      task.status = body.status;
      state.learningPlans.forEach((p) => {
        const tasks = state.learningTasks.filter((t) => t.task_date >= p.start_date && t.task_date <= p.end_date);
        p.completed_tasks = tasks.filter((t) => t.status === 'completed').length;
        p.total_tasks = tasks.length || p.total_tasks;
      });
      return jsonResponse(task);
    }
    if (/^\/api\/learning\/plans\/[^/]+$/.test(path)) {
      const id = path.split('/').pop();
      const plan = state.learningPlans.find((p) => p.id === id);
      if (!plan) return fail('计划不存在', 404);
      if (method === 'DELETE') {
        state.learningPlans = state.learningPlans.filter((p) => p.id !== id);
        return new Response(null, { status: 204 });
      }
      return jsonResponse({
        ...plan,
        tasks: state.learningTasks.filter(
          (t) => t.task_date >= plan.start_date && t.task_date <= plan.end_date,
        ),
      });
    }
    if (path === '/api/learning/questions/analyze' && method === 'POST') {
      if (!String(body.question || '').trim()) return fail('题目不能为空', 422);
      return jsonResponse(R.analyzeQuestion(body.question));
    }
    if (path === '/api/learning/math/verify' && method === 'POST') {
      return jsonResponse(R.verifyMath(body.expression, body.expected, body.variables));
    }
    if (path === '/api/learning/python/test' && method === 'POST') {
      const tests = body.tests || [];
      return jsonResponse({
        passed: false,
        results: tests.map((t, i) => ({
          index: i,
          passed: false,
          expected: t.expected_stdout || '',
          actual: '',
          error: '静态演示环境不执行 Python 代码，请在完整部署版中运行。',
        })),
        duration_ms: 0,
        policy: '静态演示环境未启用代码沙箱',
      });
    }
    if (path === '/api/learning/wrong-questions' && method === 'GET') return jsonResponse(state.wrongQuestions);
    if (path === '/api/learning/wrong-questions' && method === 'POST') {
      const q = {
        id: uid('wq'),
        question: body.question,
        subject: body.subject || '通用',
        question_type: body.question_type || 'concept',
        knowledge_points: body.knowledge_points || [],
        user_answer: body.user_answer || null,
        correct_answer: body.correct_answer || null,
        review_note: body.review_note || null,
        status: 'new',
        created_at: isoOf(new Date()),
        updated_at: isoOf(new Date()),
      };
      state.wrongQuestions.unshift(q);
      return jsonResponse(q);
    }
    if (/^\/api\/learning\/wrong-questions\/[^/]+$/.test(path)) {
      const id = path.split('/').pop();
      const idx = state.wrongQuestions.findIndex((q) => q.id === id);
      if (idx === -1) return fail('错题不存在', 404);
      if (method === 'DELETE') {
        state.wrongQuestions.splice(idx, 1);
        return new Response(null, { status: 204 });
      }
      Object.assign(state.wrongQuestions[idx], body, { updated_at: isoOf(new Date()) });
      return jsonResponse(state.wrongQuestions[idx]);
    }

    return fail(`演示版未实现的接口：${method} ${path}`, 404);
  }

  /* ================= fetch 劫持 ================= */

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function demoFetch(input, init) {
    const options = init || {};
    let url;
    try {
      url = typeof input === 'string' ? input : input.url;
    } catch {
      return originalFetch(input, init);
    }
    const method = String(options.method || (input && input.method) || 'GET').toUpperCase();
    const parsed = new URL(url, window.location.href);
    const apiIndex = parsed.pathname.indexOf('/api/');
    if (apiIndex === -1) return originalFetch(input, init);

    const apiPath = parsed.pathname.slice(apiIndex);
    const params = new URLSearchParams(parsed.search);

    let body = {};
    const rawBody = options.body;

    try {
      if (rawBody instanceof Blob) {
        const file = rawBody;
        const text = await readFileText(file);
        const det = R.detectPrivacy(text, params.get('masking_style') || 'placeholder');
        const record = pushRecord(det, text.length, new Date());
        if (apiPath === '/api/privacy/documents/inspect') {
          return jsonResponse({
            filename: params.get('filename') || file.name || 'document',
            module: 'privacy',
            inspection_target: 'input',
            safe: det.safe,
            risk_score: det.risk_score,
            provider: det.provider,
            findings: det.findings,
            sanitized_text: det.sanitized_text,
            warnings: [],
            elapsed_ms: det.elapsed_ms,
            record_id: record.id,
          });
        }
        return fail(`演示版未实现的接口：${method} ${apiPath}`, 404);
      }
      if (typeof rawBody === 'string' && rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = {};
        }
      } else if (rawBody && typeof rawBody === 'object' && !(rawBody instanceof Blob)) {
        body = rawBody;
      }
    } catch (error) {
      return fail(`请求解析失败：${error.message}`, 400);
    }

    try {
      const result = route(method, apiPath, params, body);
      return result instanceof Response ? result : jsonResponse(result);
    } catch (error) {
      console.error('[demo] 处理失败', method, apiPath, error);
      return fail(`演示环境处理异常：${error.message}`, 500);
    }
  };

  console.info(
    '%c校园 AI 安全网关 · 静态演示版',
    'background:#2563eb;color:#fff;padding:2px 8px;border-radius:4px',
    '检测与脱敏由本地规则引擎执行，数据不离开浏览器。',
  );
})();
