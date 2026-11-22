/**
 * 演示版规则引擎：与后端 builtin-rules 保持一致的判定逻辑。
 * 规则来源：config/safety_rules.yaml（内容安全）+ app/detectors/privacy.py（隐私实体）
 * 全部在浏览器本地执行，不依赖任何后端服务。
 */
(function (global) {
  'use strict';

  /* ============ 内容安全规则（逐条移植自 safety_rules.yaml） ============ */

  const CONTENT_RULES = [
    {
      id: 'prompt_injection',
      category: '提示词注入',
      severity: 'high',
      score: 85,
      message: '检测到绕过系统规则或读取系统提示词的请求',
      patterns: [
        /忽略(之前|以上|所有)(的)?(指令|规则|提示)/i,
        /(忽略|无视|忘记|跳过|覆盖|解除).{0,12}(之前|以上|所有|系统|开发者|平台).{0,12}(指令|规则|提示词|限制|约束|安全策略)/i,
        /ignore\s+(all\s+)?(previous|above)\s+instructions/i,
        /(override|bypass|ignore).{0,20}(system|developer|safety)\s+(prompt|instruction|policy)/i,
        /(system|developer)\s+(prompt|message|instruction)/i,
        /(输出|泄露|显示|打印|复述|背诵|告诉我).{0,8}(系统|开发者|隐藏|内部|初始).{0,8}(提示词|消息|指令|设定)/i,
        /(进入|开启|切换到?).{0,6}(开发者模式|上帝模式|无限制模式|越狱模式)/i,
        /(假装|扮演).{0,10}(没有规则|不受限制|另一个AI|系统管理员)/i,
        /(从现在开始|接下来).{0,8}(不要|不用|无需).{0,8}(遵守|遵循|受限于).{0,8}(规则|限制|政策)/i,
        /绕过(安全|内容|审核)(规则|限制)/i,
        /\bDAN\b|jailbreak/i,
      ],
      exclude: [
        /(什么是|解释|科普|识别|防范|防御|检测|研究).{0,12}(提示词注入|系统提示词|越狱)/i,
      ],
    },
    {
      id: 'self_harm',
      category: '自伤风险',
      severity: 'critical',
      score: 100,
      message: '内容可能涉及自伤或轻生风险，需要人工安全干预',
      patterns: [
        /自杀|轻生|不想活|结束生命/i,
        /自残|割腕|伤害自己/i,
        /(想|准备|打算).{0,4}(死|自杀|轻生)/i,
        /活着没意思|活着没意义|不如死了|想跳楼|结束自己/i,
        /(写好了|准备了|已经写了).{0,6}(遗书|告别信)/i,
        /(今晚|今天|明天).{0,10}(结束生命|自杀|轻生)/i,
        /不想醒过来|想从.{0,8}(楼|桥|天台).{0,4}(跳下|跳下去)/i,
      ],
      exclude: [/(预防|防止|帮助|支持|关心).{0,8}(自杀|轻生|自残)/i],
    },
    {
      id: 'violence',
      category: '暴力伤害',
      severity: 'high',
      score: 90,
      message: '检测到可能涉及暴力伤害的表述',
      patterns: [
        /(想|要|准备|打算|计划).{0,4}(杀|弄死|打死|伤害).{0,4}(人|他|她|你|他们)/i,
        /杀(人|死|掉)/i,
        /(想|要|准备|打算|计划).{0,4}(砍|捅|打).{0,4}(人|他|她|你|同学|老师)/i,
        /砍死|捅死|投毒/i,
        /制造(炸弹|爆炸物)/i,
        /(我要|我会).{0,6}(杀了|打死|捅死|砍死).{0,6}(你|他|她|你们|他们)/i,
        /(准备|打算|计划).{0,6}(带|拿).{0,6}(刀|枪|武器).{0,6}(去|进).{0,8}(学校|教室|宿舍)/i,
      ],
      exclude: [
        /(不要|不能|不想|不会|不准|禁止|拒绝|反对|防止|避免).{0,8}(杀人|伤害|暴力)/i,
        /(如何|怎样).{0,6}(防范|避免|应对).{0,6}(杀人|暴力)/i,
      ],
    },
    {
      id: 'illegal_content',
      category: '违法危险内容',
      severity: 'high',
      score: 88,
      message: '内容可能涉及违法物品或危险行为',
      patterns: [
        /毒品|冰毒|海洛因/i,
        /购买(枪支|弹药)/i,
        /制作(炸药|爆炸物)/i,
        /(怎样|怎么|如何|教我).{0,8}(制作|制造|组装|自制).{0,8}(炸弹|爆炸物|枪支|毒品)/i,
        /(购买|出售|贩卖).{0,6}(毒品|枪支|弹药|违禁品)/i,
        /(教我|帮我).{0,8}(盗取|偷窃|抢劫|纵火|投毒)/i,
      ],
      exclude: [],
    },
    {
      id: 'privacy_request',
      category: '隐私索取',
      severity: 'medium',
      score: 65,
      message: '内容可能试图获取他人的个人隐私信息',
      patterns: [
        /(查|获取|告诉我|列出).{0,8}(身份证号|家庭住址|手机号|银行卡号)/i,
        /别人的(个人信息|成绩|家庭情况)/i,
        /(手机号|身份证号|家庭住址|银行卡号).{0,6}(给我|发我|告诉我|查一下|是多少)/i,
        /(把|帮我把).{0,8}(手机号|身份证号|家庭住址|银行卡号).{0,8}(给我|查出来|发来)/i,
        /(查|找|获取|告诉我|发我).{0,8}(别人的|同学的|某人的|室友的).{0,10}(手机号|身份证号|家庭住址|学号|成绩|课表|定位|聊天记录)/i,
        /(把|给我|发我).{0,10}(同学|别人|室友).{0,10}(课表|成绩|照片|聊天记录|定位)/i,
        /(帮我|教我).{0,8}(人肉|开盒|定位).{0,8}(同学|老师|某人|别人)/i,
      ],
      exclude: [],
    },
    {
      id: 'academic_integrity',
      category: '学术诚信',
      severity: 'high',
      score: 82,
      message: '内容可能涉及代写作业、考试作弊或规避学术规范',
      patterns: [
        /代写.{0,8}(作业|论文|报告)/i,
        /考试(作弊|答案)/i,
        /帮我(考试|完成考试)/i,
        /(直接|马上|立刻).{0,6}(给我|发我|告诉我).{0,6}(答案|解题过程|代码)/i,
        /(帮我|替我).{0,6}(完成|做完|写).{0,6}(作业|论文|报告|编程题)/i,
        /(把|给).{0,6}(答案|代码).{0,6}(发|给).{0,4}我/i,
        /(当然可以|可以).{0,10}(直接)?(给|发).{0,4}(你|我).{0,4}答案/i,
        /(帮我|替我).{0,8}(写|做|完成).{0,8}(整套|全部|完整).{0,8}(作业|论文|报告|代码)/i,
        /(给|提供).{0,8}(可直接提交|完整成稿|最终稿).{0,8}(答案|作业|论文|代码)/i,
        /(绕过|规避|降低|骗过).{0,8}(查重|AI检测|反作弊|老师检查)/i,
      ],
      exclude: [
        /(什么是|如何|怎样|怎么).{0,10}(识别|判断|避免|防止|举报).{0,10}(代写|作弊|学术不端)/i,
        /(解释|讨论|研究).{0,8}学术诚信/i,
      ],
    },
    {
      id: 'cyber_abuse',
      category: '账号与系统入侵',
      severity: 'high',
      score: 88,
      message: '内容可能涉及入侵账号、绕过认证或破坏校园信息系统',
      patterns: [
        /(入侵|黑进|盗取|破解).{0,10}(账号|密码|系统|教务|校园网|服务器)/i,
        /(绕过|破解).{0,8}(登录|验证码|身份认证|人脸识别)/i,
        /(钓鱼网站|木马程序|勒索软件|键盘记录器)/i,
        /(获取|窃取).{0,8}(同学|老师|管理员).{0,8}(账号|密码|权限)/i,
      ],
      exclude: [
        /(防范|防御|检测|识别|修复|举报|研究).{0,10}(入侵|钓鱼|木马|勒索软件|校园网)/i,
      ],
    },
    {
      id: 'harassment_bullying',
      category: '骚扰与网络霸凌',
      severity: 'high',
      score: 88,
      message: '内容可能涉及校园骚扰、网络霸凌或隐私羞辱',
      patterns: [
        /(帮我|教我|一起).{0,8}(人肉|曝光|羞辱|孤立|骚扰|网暴).{0,8}(同学|老师|某人|别人)/i,
        /(造黄谣|散播谣言|偷拍|尾随|P成丑照).{0,10}(同学|老师|某人|别人)?/i,
        /(威胁|逼迫).{0,8}(同学|老师|别人).{0,8}(发照片|公开隐私|转账|见面)/i,
      ],
      exclude: [
        /(如何|怎样|怎么).{0,10}(识别|应对|防止|举报|帮助).{0,10}(霸凌|网暴|骚扰)/i,
        /(什么是|解释).{0,8}(网络霸凌|校园霸凌|性骚扰)/i,
      ],
    },
  ];

  /* ============ 隐私实体规则（移植自 privacy.py） ============ */

  const PRIVACY_RULES = [
    {
      entity: 'id_card',
      category: '身份证号',
      severity: 'critical',
      score: 98,
      message: '检测到疑似身份证号码',
      regex: /(^|[^0-9A-Za-z])(\d{17}[\dXx])(?![0-9A-Za-z])/g,
      group: 2,
    },
    {
      entity: 'bank_card',
      category: '银行卡号',
      severity: 'high',
      score: 92,
      message: '检测到疑似银行卡号码',
      regex: /(^|[^\d])(\d{16,19})(?!\d)/g,
      group: 2,
    },
    {
      entity: 'phone',
      category: '手机号码',
      severity: 'high',
      score: 88,
      message: '检测到手机号码',
      regex: /(^|[^\d])(1[3-9]\d{9})(?!\d)/g,
      group: 2,
    },
    {
      entity: 'student_id',
      category: '学号',
      severity: 'high',
      score: 82,
      message: '检测到带标识的学号信息',
      regex: /(?:学号|学生编号|student\s*id)\s*[:：]?\s*([A-Za-z0-9-]{6,24})/gi,
      group: 1,
    },
    {
      entity: 'address',
      category: '地址',
      severity: 'medium',
      score: 72,
      message: '检测到带标识的地址信息',
      regex: /(?:家庭住址|联系地址|住址|地址)\s*[:：]?\s*([^\n，。；]{4,60})/g,
      group: 1,
    },
    {
      entity: 'email',
      category: '电子邮箱',
      severity: 'medium',
      score: 70,
      message: '检测到电子邮箱地址',
      regex: /(^|[^\w.+-])([\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?![\w.-])/g,
      group: 2,
    },
    {
      entity: 'name',
      category: '姓名',
      severity: 'medium',
      score: 68,
      message: '检测到带标识的姓名信息',
      regex: /(?:姓名|学生姓名|联系人)\s*[:：]?\s*([\u4e00-\u9fff·]{2,12})/g,
      group: 1,
    },
  ];

  const PLACEHOLDERS = {
    phone: '[手机号]',
    id_card: '[身份证号]',
    email: '[邮箱]',
    student_id: '[学号]',
    bank_card: '[银行卡号]',
    name: '[姓名]',
    address: '[地址]',
    ip_address: '[IP地址]',
  };

  /* ============ 公共判定 ============ */

  function riskLevel(score) {
    if (score >= 80) return 'high';
    if (score >= 50) return 'medium';
    if (score > 0) return 'low';
    return 'safe';
  }

  /** 内容安全检测：与后端 RuleContentDetector.inspect 逻辑一致 */
  function detectContent(text, inspectionTarget) {
    const started = performance.now();
    const source = String(text || '');
    const findings = [];
    let riskScore = 0;

    for (const rule of CONTENT_RULES) {
      if (rule.exclude.some((re) => re.test(source))) continue;

      let match = null;
      for (const re of rule.patterns) {
        re.lastIndex = 0;
        const found = re.exec(source);
        if (found) {
          match = found;
          break;
        }
      }
      if (!match) continue;

      findings.push({
        category: rule.category,
        severity: rule.severity,
        message: rule.message,
        start: match.index,
        end: match.index + match[0].length,
      });
      riskScore = Math.max(riskScore, rule.score);
    }

    return {
      module: 'content',
      inspection_target: inspectionTarget || 'input',
      safe: findings.length === 0,
      risk_score: riskScore,
      provider: 'builtin-rules',
      findings,
      sanitized_text: null,
      warnings: [],
      elapsed_ms: Math.max(1, Math.round(performance.now() - started)),
    };
  }

  function maskValue(entity, value, style) {
    if (style === 'placeholder') {
      return PLACEHOLDERS[entity] || '[已脱敏]';
    }
    if (value.length <= 2) return '*'.repeat(value.length);
    if (entity === 'email' && value.indexOf('@') > -1) {
      const [local, domainName] = value.split('@');
      const visible = local.slice(0, 1);
      return visible + '*'.repeat(Math.max(3, local.length - 1)) + '@' + domainName;
    }
    return value[0] + '*'.repeat(value.length - 2) + value[value.length - 1];
  }

  /** 隐私检测：与后端 RulePrivacyDetector.inspect 逻辑一致（含重叠抑制） */
  function detectPrivacy(text, maskingStyle) {
    const started = performance.now();
    const source = String(text || '');
    const style = maskingStyle === 'mask' ? 'mask' : 'placeholder';
    const occupied = [];
    const matches = [];

    const ordered = PRIVACY_RULES.slice().sort((a, b) => b.score - a.score);

    for (const item of ordered) {
      item.regex.lastIndex = 0;
      let m;
      while ((m = item.regex.exec(source)) !== null) {
        if (m[0] === '') {
          item.regex.lastIndex += 1;
          continue;
        }
        const value = m[item.group];
        if (!value) continue;
        const start = m.index + m[0].indexOf(value);
        const end = start + value.length;
        const overlapped = occupied.some(([s, e]) => start < e && end > s);
        if (overlapped) continue;
        occupied.push([start, end]);
        matches.push({ item, start, end, value });
      }
    }

    matches.sort((a, b) => a.start - b.start);

    const findings = matches.map(({ item, start, end }) => ({
      category: item.category,
      severity: item.severity,
      message: item.message,
      start,
      end,
    }));
    const riskScore = matches.reduce((max, m) => Math.max(max, m.item.score), 0);

    let sanitized = source;
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const m = matches[i];
      const replacement = maskValue(m.item.entity, m.value, style);
      sanitized = sanitized.slice(0, m.start) + replacement + sanitized.slice(m.end);
    }

    return {
      module: 'privacy',
      inspection_target: 'input',
      safe: findings.length === 0,
      risk_score: riskScore,
      provider: 'builtin-rules',
      findings,
      sanitized_text: sanitized,
      warnings: [],
      elapsed_ms: Math.max(1, Math.round(performance.now() - started)),
    };
  }

  /* ============ 学习工具：题目解析与数学校验 ============ */

  const KNOWLEDGE_POINTS = [
    ['一元二次方程', /x\^2|x²|二次方程|判别式|韦达定理/],
    ['函数与图像', /函数|f\(x\)|图像|斜率|截距/],
    ['导数与极值', /导数|求导|极值|单调|切线/],
    ['概率统计', /概率|期望|方差|排列|组合/],
    ['三角函数', /sin|cos|tan|正弦|余弦|弧度/],
    ['数列与极限', /数列|等差|等比|极限|通项/],
    ['集合与逻辑', /集合|交集|并集|命题|充分必要/],
    ['循环与迭代', /for|while|range|循环|迭代/],
    ['函数与参数', /def\s|return|参数|调用|lambda/],
    ['列表与字典', /list|dict|append|列表|字典|下标/],
    ['字符串处理', /str|split|join|字符串|f"/],
    ['异常处理', /try|except|error|异常/],
  ];

  function analyzeQuestion(question) {
    const text = String(question || '');
    const isPython = /(python|print\(|def\s|import\s|for\s+\w+\s+in|while\s)/i.test(text);
    const hasMath = /[0-9].*[+\-*/^=]|[fF]\(x\)|方程|求解|计算|证明/.test(text);

    const subject = isPython ? 'Python' : hasMath ? '数学' : '通用';
    const points = KNOWLEDGE_POINTS.filter(([, re]) => re.test(text)).map(
      ([name]) => name,
    );
    if (points.length === 0) {
      points.push(subject === 'Python' ? '基础语法' : '基础概念理解');
    }

    let questionType = 'concept';
    if (isPython) questionType = 'code';
    else if (/求|计算|算一算|等于|解方程/.test(text)) questionType = 'calculation';
    else if (/证明|求证/.test(text)) questionType = 'proof';
    else if (/应用|实际问题|多少米|多少元/.test(text)) questionType = 'application';

    const difficulty = points.length >= 3 ? '进阶' : points.length === 2 ? '中等' : '基础';

    return {
      subject,
      question_type: questionType,
      knowledge_points: points.slice(0, 4),
      difficulty,
      recommended_modes: ['hint', 'step_by_step', 'review'],
      answer_modes: {
        hint: [
          '这道题可以先想清楚「已知什么、要求什么」。',
          `涉及的知识点是：${points.slice(0, 3).join('、')}。`,
          '试着把条件先写成式子的形式，再考虑需要哪一步变形。提示只到这里，先自己动笔试试。',
        ].join('\n'),
        step_by_step: [
          '第一步：梳理条件。把题目中的已知量、未知量分别列出来。',
          `第二步：定位方法。本题属于「${points[0]}」相关题型，先回忆对应的标准解法。`,
          '第三步：列式求解。把条件翻译成式子，逐步化简，每一步都检查是否等价。',
          '第四步：回代验证。把结果带回原条件检查是否成立，确认没有漏解或多解。',
        ].join('\n'),
        review: [
          '自查清单：',
          '· 条件是否全部用到？有没有遗漏的限制（定义域、取值范圄）？',
          '· 关键变形是否可逆？两边同时乘除时是否讨论了零的情况？',
          '· 结论是否回答了题目问的问题，而不是算了另一个量？',
          '· 单位与有效数字是否符合题意？',
        ].join('\n'),
      },
      similar_question: '把原题中的已知量改为另一组数值，保持结构不变，再完整做一遍以检验方法是否真正掌握。',
      learning_tip: `建议用「先讲给自己听」的方式复述${points[0]}的核心结论，能讲清楚说明真懂了。`,
    };
  }

  /** 数学校验：支持纯数值表达式与含变量的等式代入比较 */
  function verifyMath(expression, expected, variables) {
    const raw = String(expression || '').trim();
    if (!raw) {
      return {
        supported: false,
        matches: null,
        expression_value: null,
        expected_value: null,
        provider: 'browser-math',
        detail: '表达式为空',
      };
    }

    const vars = variables && typeof variables === 'object' ? variables : {};
    const normalize = (src) => src.replace(/\^/g, '**');

    const evalExpr = (src) => {
      const prepared = normalize(src).replace(/[×·]/g, '*').replace(/÷/g, '/');
      if (!/^[\d\s+\-*/().]*$/.test(prepared.replace(/[a-zA-Z_]\w*/g, ''))) {
        throw new Error('包含不支持的符号');
      }
      const names = Object.keys(vars);
      const args = names.map((n) => Number(vars[n]));
      const body = 'return (' + prepared + ');';
      // eslint-disable-next-line no-new-func
      const fn = new Function(...names, body);
      const value = fn(...args);
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('结果不是有限数值');
      }
      return value;
    };

    try {
      if (raw.indexOf('=') > -1) {
        const [left, right] = raw.split('=');
        const lv = evalExpr(left);
        const rv = evalExpr(right);
        const equal = Math.abs(lv - rv) < 1e-9;
        return {
          supported: true,
          matches: equal,
          expression_value: String(Number(lv.toFixed(10))),
          expected_value: String(Number(rv.toFixed(10))),
          provider: 'browser-math',
          detail: equal
            ? '等式两边取值一致，代入成立。'
            : '等式两边取值不一致，请检查变量取值或化简过程。',
        };
      }

      const value = evalExpr(raw);
      const rounded = Number(value.toFixed(10));
      let matches = null;
      let expectedValue = null;
      if (expected !== undefined && expected !== null && String(expected).trim() !== '') {
        try {
          expectedValue = String(Number(evalExpr(String(expected)).toFixed(10)));
          matches = Math.abs(value - Number(expectedValue)) < 1e-9;
        } catch {
          expectedValue = String(expected);
          matches = String(rounded) === String(expected).trim();
        }
      }
      return {
        supported: true,
        matches,
        expression_value: String(rounded),
        expected_value: expectedValue,
        provider: 'browser-math',
        detail: matches === null
          ? '已求出表达式取值。'
          : matches
            ? '与预期结果一致。'
            : '与预期结果不一致。',
      };
    } catch (error) {
      return {
        supported: false,
        matches: null,
        expression_value: null,
        expected_value: null,
        provider: 'browser-math',
        detail: `当前环境无法解析该表达式：${error.message}`,
      };
    }
  }

  global.DemoRules = {
    detectContent,
    detectPrivacy,
    maskValue,
    riskLevel,
    analyzeQuestion,
    verifyMath,
    CONTENT_RULES,
    PRIVACY_RULES,
  };
})(window);
