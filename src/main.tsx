import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import katex from "katex";
import mermaid from "mermaid";
import "katex/dist/katex.min.css";
import "./styles.css";

type NavKey = "welcome" | "projects" | "studio" | "profile" | "output" | "resources" | "evidence" | "system";
type ResourceType = "讲义" | "思维导图" | "题库" | "阅读" | "实验";

type Project = {
  id: string;
  name: string;
  course: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  files: { source: string; name: string; pages: number; chunks: number }[];
  chunks: number;
};

type StatusPayload = {
  sparkConfigured: boolean;
  projects: Project[];
  activeProjectId: string | null;
};

type Evidence = {
  id: string;
  source: string;
  name?: string;
  chunkIndex: number;
  text: string;
  score: number;
  page?: number;
};

type ProfileDimension = {
  label: string;
  value: string;
  score?: number;
  manual?: boolean;
};

type Conversation = { id: string; title: string; archived: boolean; updatedAt: string; turns: SessionTurn[] };
type SessionTurn = { id: string; question: string; answer: string; createdAt: string };

type ChatResult = {
  answer: string;
  evidence: Evidence[];
  profile: ProfileDimension[];
  usedSpark: boolean;
  agentTrace?: AgentTrace[];
  sessionCount?: number;
  membership?: Membership;
  profileChanges?: { label: string; value: string }[];
  activeConversationId?: string | null;
};

type PromptResult = { prompts: Array<string | Record<string, unknown>>; usedSpark: boolean };
type CandidateBundle = {
  questions: string[];
  resources: Record<ResourceType, string[]>;
};
type PlatformLibraryFile = { id: string; name: string; size: number };
type Membership = { active: boolean; quotaTokens: number; usedTokens: number; remainingTokens: number; redeemedAt: string | null };
type AuthUser = { id: string; name: string; email: string; role: "user" | "admin"; membership: Membership };
type AuthResult = { token: string; user: AuthUser };
type SearchResult = {
  type: "project" | "file" | "knowledge";
  projectId: string;
  title: string;
  subtitle: string;
  source?: string;
  page?: number;
  excerpt?: string;
};
type ActivitySummary = {
  days: { date: string; minutes: number }[];
  hours: number[];
  totalMinutes: number;
  activeDays: number;
  peakHour: number;
  projectCount: number;
  questionCount: number;
  joinedAt: string;
};
type MembershipCode = { id: string; code: string; quotaTokens: number; status: string; redeemedBy?: string | null; createdAt: string };
type AdminUser = AuthUser & { totalMinutes: number; createdAt: string };

type AgentTrace = {
  name: string;
  model: string;
  status: string;
};

type SessionPayload = {
  session: { conversations?: Conversation[]; activeConversationId?: string | null };
  texReady: boolean;
  pdfReady: boolean;
};

function RadarProfile({ profile }: { profile: ProfileDimension[] }) {
  const size = 210; const center = size / 2; const radius = 74;
  const points = profile.map((item, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(1, profile.length);
    const value = Math.max(18, Math.min(100, item.score || 45));
    return { ...item, x: center + Math.cos(angle) * radius * value / 100, y: center + Math.sin(angle) * radius * value / 100, lx: center + Math.cos(angle) * (radius + 23), ly: center + Math.sin(angle) * (radius + 23) };
  });
  return <svg className="profile-radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="六维动态学习画像雷达图">
    {[0.33, 0.66, 1].map((scale) => <polygon key={scale} points={points.map((_, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(1, points.length); return `${center + Math.cos(angle) * radius * scale},${center + Math.sin(angle) * radius * scale}`; }).join(" ")} />)}
    {points.map((point) => <line key={point.label} x1={center} y1={center} x2={point.lx} y2={point.ly} />)}
    <polygon className="profile-radar-area" points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
    {points.map((point) => <g key={point.label}><circle cx={point.x} cy={point.y} r="3.2" /><text x={point.lx} y={point.ly}>{point.label}</text></g>)}
  </svg>;
}

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://127.0.0.1:8789" : "");
const AUTH_TOKEN_KEY = "omnilearn-mas-auth-token";
const LEGACY_AUTH_TOKEN_KEY = "study-agent-auth-token";
const AUTH_EXPIRED_EVENT = "omnilearn-mas-auth-expired";
const PROFILE_SURVEY_KEY = "omnilearn-mas-profile-survey";
const LEGACY_PROFILE_SURVEY_KEY = "study-agent-profile-survey";

function authToken() {
  const current = localStorage.getItem(AUTH_TOKEN_KEY);
  if (current) return current;
  const legacy = localStorage.getItem(LEGACY_AUTH_TOKEN_KEY) || "";
  if (legacy) {
    localStorage.setItem(AUTH_TOKEN_KEY, legacy);
    localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
  }
  return legacy;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // HTTP origins and restrictive browser policies may block the Clipboard API.
    }
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  return copied;
}

const navItems: { key: NavKey; label: string; hint: string }[] = [
  { key: "profile", label: "画像", hint: "动态更新" },
  { key: "projects", label: "项目", hint: "课程与资料" },
  { key: "studio", label: "问答", hint: "讲解与追问" },
  { key: "resources", label: "资源", hint: "专项生成" },
  { key: "evidence", label: "引用", hint: "原文核验" },
  { key: "system", label: "系统", hint: "团队与智能体" },
];

const pageRailItems: { key: NavKey; label: string; target: string }[] = [
  { key: "welcome", label: "欢迎", target: "welcome-section" },
  { key: "projects", label: "项目概览", target: "projects-section" },
  { key: "studio", label: "学习问答", target: "studio-section" },
  { key: "profile", label: "动态画像", target: "profile-page-section" },
  { key: "output", label: "生成结果", target: "output-section" },
  { key: "resources", label: "资源生成", target: "resources-section" },
  { key: "evidence", label: "引用导出", target: "evidence-page" },
  { key: "system", label: "系统信息", target: "system-section" },
];

// The onboarding flow starts with the profile before a course project exists.
const profilePage = pageRailItems.splice(3, 1)[0];
if (profilePage) pageRailItems.splice(1, 0, profilePage);

const agents = [
  { name: "画像智能体", role: "从自然语言抽取目标、基础、偏好、薄弱点", model: "Spark X2", active: true },
  { name: "检索智能体", role: "在当前课程知识库中定位证据切片", model: "本地 RAG", active: true },
  { name: "讲解智能体", role: "生成课程讲义、推导说明与类比解释", model: "Spark X2 / X1.5", active: true },
  { name: "训练智能体", role: "生成分层题库、错题变式和答案解析", model: "Spark X2", active: true },
  { name: "路径智能体", role: "按先修关系和掌握度重排学习步骤", model: "Spark X2", active: true },
  { name: "安全智能体", role: "校验证据、不确定结论与输出边界", model: "规则校验 + Spark", active: true },
];

// Shared SVG coordinates keep each node, connector, and card aligned at every width.
const agentLayout = [
  { node: [120, 58], card: [8, 78], anchor: [120, 78] },
  { node: [250, 35], card: [300, 5], anchor: [300, 30] },
  { node: [320, 184], card: [400, 130], anchor: [430, 154] },
  { node: [380, 300], card: [100, 250], anchor: [280, 282] },
  { node: [730, 276], card: [635, 136], anchor: [730, 258] },
  { node: [1060, 310], card: [900, 100], anchor: [1000, 220] },
] as const;

const defaultProfile: ProfileDimension[] = [
  { label: "知识基础", value: "等待首轮提问识别" },
  { label: "学习目标", value: "等待首轮提问识别" },
  { label: "认知风格", value: "等待首轮提问识别" },
  { label: "资源偏好", value: "等待首轮提问识别" },
  { label: "薄弱点", value: "等待首轮提问识别" },
  { label: "反馈节奏", value: "等待首轮提问识别" },
];

const profileQuestions = [
  { key: "gender", label: "形象性别", options: ["男", "女"] },
  { key: "level", label: "当前基础", options: ["刚入门", "学过但不稳", "能做基础题", "准备冲刺提高题"] },
  { key: "goal", label: "学习目标", options: ["期末复习", "考研/竞赛", "工程实践", "补齐概念"] },
  { key: "style", label: "理解偏好", options: ["公式推导", "例题驱动", "图解直观", "代码实验"] },
  { key: "pace", label: "反馈节奏", options: ["先结论后细节", "一步一步追问", "多给练习", "多给类比"] },
  { key: "drive", label: "学习驱动力", options: ["统筹全局", "深挖原理", "探索创新", "动手实践", "冲刺突破", "稳步筑基"] },
];

const avatarArchetypes: Record<string, string> = {
  统筹全局: "全局统筹的拼图领航员",
  深挖原理: "刨根问底的深潜学者",
  探索创新: "天马行空的星际漫游者",
  动手实践: "实践为王的硬核创客",
  冲刺突破: "极限突击的火箭骑手",
  稳步筑基: "步步为营的筑基匠人",
};

function resolveAvatar(survey: Record<string, string>) {
  const gender = survey.gender;
  if (gender !== "男" && gender !== "女") return null;
  let drive = survey.drive;
  if (!drive) {
    if (survey.style === "代码实验" || survey.goal === "工程实践") drive = "动手实践";
    else if (survey.style === "公式推导") drive = "深挖原理";
    else if (survey.style === "图解直观" || survey.pace === "多给类比") drive = "探索创新";
    else if (survey.goal === "考研/竞赛" || survey.level === "准备冲刺提高题") drive = "冲刺突破";
    else if (survey.goal === "期末复习" || survey.pace === "先结论后细节") drive = "统筹全局";
    else drive = "稳步筑基";
  }
  const archetype = avatarArchetypes[drive] || avatarArchetypes.稳步筑基;
  return { archetype, src: `/avatars/${gender}/${archetype}.png` };
}

function greetingForHour(hour: number) {
  if (hour < 6) return { title: "夜深了", note: "适合做一次轻量回顾，别忘了给大脑留出休息时间" };
  if (hour < 9) return { title: "早上好", note: "清醒时先攻克一个关键概念，今天会更从容" };
  if (hour < 12) return { title: "上午好", note: "专注力正在线，适合推进推导、例题或知识梳理" };
  if (hour < 14) return { title: "中午好", note: "可以用一组短练习巩固上午的学习成果" };
  if (hour < 18) return { title: "下午好", note: "适合继续推进项目，也可以针对薄弱点做一次专项训练" };
  return { title: "晚上好", note: "把今天的问题沉淀下来，完成一次有证据的学习复盘" };
}

const resourceBlueprints: Array<{
  type: ResourceType;
  title: string;
  desc: string;
  model: string;
}> = [
  {
    type: "讲义",
    title: "个性化讲义",
    desc: "围绕一个概念输出结论、边界、公式、例题和易错点。",
    model: "Spark X2",
  },
  {
    type: "思维导图",
    title: "知识关系图",
    desc: "生成可渲染的 Mermaid 图，突出先修关系和易混点。",
    model: "Spark X2",
  },
  {
    type: "题库",
    title: "分层练习题",
    desc: "基础、提高、综合三层题目，带标准答案与解析。",
    model: "Spark X2",
  },
  {
    type: "阅读",
    title: "拓展阅读单",
    desc: "按先修、深入、工程应用推荐阅读顺序。",
    model: "Spark X1.5",
  },
  {
    type: "实验",
    title: "实操案例",
    desc: "生成 Python/MATLAB 实验目标、步骤、代码和观察问题。",
    model: "Spark X2",
  },
];

function resourcePlaceholder(type: ResourceType, course?: string, candidate?: string) {
  if (candidate) return `例：${candidate}`;
  const subject = course ? `“${course}”` : "当前课程";
  const examples: Record<ResourceType, string> = {
    讲义: `例：围绕${subject}的核心章节生成一份适合复习的结构化讲义。`,
    思维导图: `例：梳理${subject}的核心概念、先修关系和常见易错点。`,
    题库: `例：围绕${subject}生成基础、提高、综合三层练习，附答案解析。`,
    阅读: `例：推荐理解${subject}核心内容所需的分层阅读材料。`,
    实验: `例：设计一个验证${subject}关键原理的 Python 或 MATLAB 实验。`,
  };
  return examples[type];
}

function candidateWidth(prompt: string) {
  const visualLength = Array.from(prompt).reduce((sum, character) => sum + (/[^\x00-\xff]/.test(character) ? 1 : 0.56), 0);
  return Math.round(Math.min(620, Math.max(280, visualLength * 14 + 58)));
}

const navTargets: Record<NavKey, string> = {
  welcome: "welcome-section",
  projects: "projects-section",
  studio: "studio-section",
  profile: "profile-page-section",
  output: "output-section",
  resources: "resources-section",
  evidence: "evidence-section",
  system: "system-section",
};

function pageIndexForKey(key: NavKey) {
  const index = pageRailItems.findIndex((item) => item.key === key);
  return index >= 0 ? index : 0;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const endpoint = url.startsWith("http") ? url : `${API_BASE}${url}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...init,
      headers: init?.body instanceof FormData
        ? { Authorization: `Bearer ${authToken()}`, ...(init.headers || {}) }
        : { "Content-Type": "application/json", Authorization: `Bearer ${authToken()}`, ...(init?.headers || {}) },
    });
  } catch {
    throw new Error("无法连接本地后端服务，请确认已在另一个终端运行：npm run server");
  }

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!contentType.includes("application/json")) {
    const preview = raw.slice(0, 90).replace(/\s+/g, " ");
    throw new Error(`后端没有返回 JSON。请确认访问的是 ${API_BASE}，返回预览：${preview}`);
  }

  const data = JSON.parse(raw);
  if (response.status === 401 && !url.startsWith("/api/auth/")) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function normalizeText(text: string) {
  const masks: string[] = [];
  const mask = (value: string) => {
    const token = `@@MASK_${masks.length}@@`;
    masks.push(value);
    return token;
  };

  const masked = text
    .replace(/\r/g, "")
    .replace(/```[\s\S]*?```/g, mask)
    .replace(/\$\$[\s\S]*?\$\$/g, mask);

  return masked
    .replace(/\\n(?=\s|[A-Z\u4e00-\u9fff])/g, " ")
    .replace(/\\\$/g, "$")
    .replace(/\\_/g, "_")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\,/g, ",")
    .replace(/([^\n])\s+(#{1,3})\s+/g, "$1\n\n$2 ")
    .replace(/\s+(#{2,3})\s+/g, "\n\n$1 ")
    .replace(/^\s*[-*]\s+(#{2,3})\s+/gm, "$1 ")
    .replace(/\*\*\s*([^*\n：:]{2,18})\s*[：:]\s*\*\*/g, "\n\n## $1\n")
    .replace(/\*\*\s*(直接结论|关键解释|公式或例子|小练习|基础题|提高题|综合题|答案与解析)\s*\*\*\s*[：:]?/g, "\n\n## $1\n")
    .replace(/(直接结论|关键解释|公式或例子|小练习|基础题|提高题|综合题|答案与解析)\s*[：:]\s+/g, "\n\n## $1\n")
    .replace(/([。；;])\s*[-*]\s+/g, "$1\n- ")
    .replace(/([。；;])\s*(\d+)[.)、]\s+/g, "$1\n$2. ")
    .replace(/([^\n])\s+([-*])\s+(?=\S)/g, "$1\n$2 ")
    .replace(/([^\n])\s+(\d+)[.)、]\s+(?=\S)/g, "$1\n$2. ")
    .replace(/([^\n])\s+(> )/g, "$1\n\n$2")
    .replace(/\\\[([\s\S]*?)\\\]/g, "$$$$ $1 $$$$")
    .replace(/\\\((.*?)\\\)/g, "$$$1$$")
    .replace(/```mermaid\s+([^\n`]+)/gi, "```mermaid\n$1")
    .replace(/^\s*(#+)\s*/gm, "$1 ")
    .replace(/^\s*(\d+)[.)、]\s*/gm, "$1. ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/@@MASK_(\d+)@@/g, (_match, index) => masks[Number(index)] || "");
}

function renderStructuredLines(lines: string[], key: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let groupType: "ul" | "ol" | "p" | null = null;
  let group: string[] = [];

  const flush = () => {
    if (!groupType || !group.length) return;
    const id = `${key}-${nodes.length}`;
    if (groupType === "ul") {
      nodes.push(
        <ul className="seg-list" key={id}>
          {group.map((line, index) => <li key={`${id}-${index}`}>{renderInline(line.replace(/^[-*]\s+/, ""))}</li>)}
        </ul>,
      );
    } else if (groupType === "ol") {
      nodes.push(
        <ol className="seg-list" key={id}>
          {group.map((line, index) => <li key={`${id}-${index}`}>{renderInline(line.replace(/^\d+\.\s+/, ""))}</li>)}
        </ol>,
      );
    } else {
      group.forEach((line, index) => {
        nodes.push(<p className="body-paragraph" key={`${id}-${index}`}>{renderInline(line)}</p>);
      });
    }
    groupType = null;
    group = [];
  };

  lines.forEach((line) => {
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      flush();
      nodes.push(<h3 key={`${key}-h-${nodes.length}`}>{heading[1]}</h3>);
      return;
    }
    const nextType = /^[-*]\s+/.test(line) ? "ul" : /^\d+\.\s+/.test(line) ? "ol" : "p";
    if (groupType && groupType !== nextType) flush();
    groupType = nextType;
    group.push(line);
  });
  flush();
  return nodes;
}

function renderInline(text: string) {
  const segments = text.split(/(\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return segments.map((segment, index) => {
    if (segment.startsWith("$") && segment.endsWith("$")) {
      const html = katex.renderToString(segment.slice(1, -1), { throwOnError: false });
      return <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} key={index} />;
    }
    if (segment.startsWith("**") && segment.endsWith("**")) {
      return <strong key={index}>{renderInline(segment.slice(2, -2))}</strong>;
    }
    if (segment.startsWith("`") && segment.endsWith("`")) {
      return <code key={index}>{segment.slice(1, -1)}</code>;
    }
    return <React.Fragment key={index}>{segment}</React.Fragment>;
  });
}

function normalizeMermaidChart(chart: string) {
  return chart
    .replace(/^```mermaid/i, "")
    .replace(/^```[a-zA-Z]*/i, "")
    .replace(/```$/i, "")
    .replace(/^\s*Mermaid\s*[:：]/i, "")
    .trim();
}

function sanitizeMermaidChart(chart: string) {
  const cleaned = normalizeMermaidChart(chart);
  const lines = cleaned.split("\n");
  const hasInit = /^\s*(flowchart|graph|mindmap|sequenceDiagram|stateDiagram)\b/i.test(cleaned);
  const output = lines.map((rawLine) => {
    const line = rawLine.trimEnd();
    if (!line.trim()) return "";
    if (/^\s*(flowchart|graph|mindmap|sequenceDiagram|stateDiagram|subgraph|end|classDef|class|style|linkStyle)\b/i.test(line)) return line;
    return line.replace(/\["([^"]*)"\]/g, (_match, label) => {
      const safe = String(label)
        .replace(/<[^>]+>/g, "")
        .replace(/\$+/g, "")
        .replace(/[`{}]/g, "")
        .replace(/\\/g, "")
        .replace(/\|/g, "/")
        .replace(/\*/g, "x")
        .replace(/"/g, "'")
        .slice(0, 52);
      return `["${safe}"]`;
    });
  }).join("\n");
  return hasInit ? output : `flowchart LR\n${output}`;
}

function renderMermaidMath(container: HTMLElement) {
  const labels = container.querySelectorAll<HTMLElement>(".nodeLabel, .edgeLabel");
  labels.forEach((label) => {
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    textNodes.forEach((node) => {
      const value = node.nodeValue || "";
      if (!/\$[^$\n]+\$/.test(value)) return;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const match of value.matchAll(/\$([^$\n]+)\$/g)) {
        const index = match.index || 0;
        if (index > cursor) fragment.append(document.createTextNode(value.slice(cursor, index)));
        const math = document.createElement("span");
        math.className = "mermaid-math";
        math.innerHTML = katex.renderToString(match[1], { throwOnError: false });
        fragment.append(math);
        cursor = index + match[0].length;
      }
      if (cursor < value.length) fragment.append(document.createTextNode(value.slice(cursor)));
      node.replaceWith(fragment);
    });
  });
}

function CodeBlock({ code, language = "" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    setCopied(await copyText(code));
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="code-shell">
      <div className="code-toolbar">
        <span>{language || "code"}</span>
        <button type="button" onClick={copyCode}>{copied ? "已复制" : "复制"}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function MermaidBlock({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    const cleaned = chart
      .replace(/^```mermaid/i, "")
      .replace(/```$/i, "")
      .replace(/^\s*Mermaid\s*[:：]/i, "")
      .trim();

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
      flowchart: { htmlLabels: true, curve: "basis" },
      themeVariables: {
        primaryColor: "#f7f4eb",
        primaryTextColor: "#16201c",
        primaryBorderColor: "#1e756b",
        lineColor: "#58706a",
        fontFamily: "Segoe UI, Microsoft YaHei, sans-serif",
      },
    });

    mermaid
      .render(id, cleaned)
      .then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          renderMermaidMath(ref.current);
        }
      })
      .catch(() => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = `<pre>${cleaned.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] || char)}</pre>`;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chart]);

  return <div className="mermaid-render" ref={ref} />;
}

function RobustMermaidBlock({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    const cleaned = normalizeMermaidChart(chart);
    const fallback = sanitizeMermaidChart(cleaned);

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
      flowchart: { htmlLabels: true, curve: "basis" },
      themeVariables: {
        primaryColor: "#f7f4eb",
        primaryTextColor: "#16201c",
        primaryBorderColor: "#1e756b",
        lineColor: "#58706a",
        fontFamily: "Segoe UI, Microsoft YaHei, sans-serif",
      },
    });

    async function renderChart() {
      try {
        const { svg } = await mermaid.render(id, cleaned);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          renderMermaidMath(ref.current);
        }
      } catch {
        try {
          const { svg } = await mermaid.render(`${id}-safe`, fallback);
          if (!cancelled && ref.current) {
            ref.current.innerHTML = svg;
            renderMermaidMath(ref.current);
          }
        } catch {
          if (!cancelled && ref.current) {
            ref.current.innerHTML = `<pre>${fallback.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] || char)}</pre>`;
          }
        }
      }
    }

    renderChart();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  const zoomOut = () => {
    setFit(false);
    setZoom((value) => Math.max(0.55, Number((value - 0.15).toFixed(2))));
  };
  const zoomIn = () => {
    setFit(false);
    setZoom((value) => Math.min(2.2, Number((value + 0.15).toFixed(2))));
  };
  const resetView = () => {
    setZoom(1);
    setFit(true);
  };

  return (
    <div className="mermaid-shell">
      <div className="mermaid-toolbar" aria-label="导图缩放工具">
        <button type="button" onClick={zoomOut} aria-label="缩小导图" title="缩小">-</button>
        <span>{fit ? "适应窗口" : `${Math.round(zoom * 100)}%`}</span>
        <button type="button" onClick={zoomIn} aria-label="放大导图" title="放大">+</button>
        <button type="button" className="fit-button" onClick={resetView}>适应</button>
      </div>
      <div
        className={`mermaid-render ${fit ? "is-fit" : "is-zoomed"}`}
        style={{ "--mermaid-width": `${Math.round(zoom * 100)}%` } as React.CSSProperties}
        ref={ref}
      />
    </div>
  );
}

function extractLooseMermaid(block: string) {
  const match = block.match(/((flowchart|graph)\s+(LR|TD|TB|RL|BT)[\s\S]*|mindmap[\s\S]*|sequenceDiagram[\s\S]*|stateDiagram[\s\S]*)/i);
  return match?.[1]?.trim() || "";
}

function renderMarkdown(text: string): React.ReactNode[] {
  const cleaned = normalizeText(text).split(/\n##\s*(引用来源|来源|References)\b/i)[0];
  const parts = cleaned.split(/(```[\s\S]*?```|\$\$[\s\S]*?\$\$)/g).filter((part) => part.trim());

  return parts.flatMap((part, partIndex) => {
    const trimmed = part.trim();
    if (/^```mermaid/i.test(trimmed)) {
      return <RobustMermaidBlock chart={trimmed.replace(/^```mermaid\n?/i, "").replace(/```$/i, "").trim()} key={`m-${partIndex}`} />;
    }
    if (trimmed.startsWith("```")) {
      const code = trimmed.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
      if (/^(flowchart|graph|mindmap|sequenceDiagram|stateDiagram)\b/i.test(code)) {
        return <RobustMermaidBlock chart={code} key={`m-code-${partIndex}`} />;
      }
      const language = trimmed.match(/^```([a-zA-Z0-9_-]+)/)?.[1] || "";
      return <CodeBlock code={code} language={language} key={`c-${partIndex}`} />;
    }
    if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) {
      const html = katex.renderToString(trimmed.slice(2, -2).trim(), { displayMode: true, throwOnError: false });
      return <div className="math-block" dangerouslySetInnerHTML={{ __html: html }} key={`math-${partIndex}`} />;
    }

    const blocks = trimmed.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    return blocks.flatMap((block, blockIndex) => {
      const key = `${partIndex}-${blockIndex}`;
      const looseMermaid = extractLooseMermaid(block);
      if (looseMermaid) return <RobustMermaidBlock chart={looseMermaid} key={key} />;
      const headingMatch = block.match(/^#{2,3}\s+([^\n]+)\n?([\s\S]*)$/);
      if (headingMatch) {
        const rest = headingMatch[2]?.trim();
        return [
          <h3 key={`${key}-h`}>{headingMatch[1]}</h3>,
          ...(rest ? renderMarkdown(rest).map((node: React.ReactNode, index: number) => <React.Fragment key={`${key}-r-${index}`}>{node}</React.Fragment>) : []),
        ];
      }
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        return (
          <ul key={key}>
            {lines.map((line, index) => (
              <li key={`${key}-${index}`}>{renderInline(line.trim().replace(/^[-*]\s+/, ""))}</li>
            ))}
          </ul>
        );
      }
      if (lines.every((line) => /^\d+\.\s+/.test(line))) {
        return (
          <ol key={key}>
            {lines.map((line, index) => (
              <li key={`${key}-${index}`}>{renderInline(line.trim().replace(/^\d+\.\s+/, ""))}</li>
            ))}
          </ol>
        );
      }
      if (lines.length > 1) return renderStructuredLines(lines, key);
      return <p key={key}>{renderInline(block)}</p>;
    });
  });
}

function formatTime(value?: string | null) {
  if (!value) return "尚未构建";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

type AuthMode = "login" | "register";

function AuthScreen({
  mode,
  onModeChange,
  onSubmit,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (values: { name: string; email: string; password: string }) => Promise<void>;
}) {
  const [name, setName] = useState("林可轩");
  const [email, setEmail] = useState("student@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isRegister = mode === "register";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), email: email.trim(), password });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
    return;
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <img className="brand-mark brand-logo" src="/LOGO.png" alt="OmniLearn | MAS" />
          <div>
            <strong>OmniLearn | MAS</strong>
            <span>个性化学习智能体平台</span>
          </div>
        </div>
        <div className="auth-copy">
          <span>Personal Learning Workspace</span>
          <h1>{isRegister ? "创建你的学习空间" : "欢迎回来"}</h1>
          <p>上传课程资料，生成讲义、题库、思维导图与可导出的学习记录。</p>
        </div>
        <div className="auth-preview">
          <div className="preview-hero">
            <strong>AI 导师</strong>
            <p>根据你的进度、薄弱点和课程资料生成下一步学习建议。</p>
          </div>
          <div className="preview-grid">
            <span>动态画像</span>
            <span>知识库检索</span>
            <span>资源生成</span>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-tabs" role="tablist" aria-label="登录注册切换">
          <button className={mode === "login" ? "active" : ""} onClick={() => onModeChange("login")} type="button">登录</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => onModeChange("register")} type="button">注册</button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          {isRegister && (
            <label>
              用户名
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入你的昵称" />
            </label>
          )}
          <label>
            邮箱
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="student@example.com" />
          </label>
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="用于演示，可暂不校验" />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-btn auth-submit" type="submit" disabled={submitting}>{submitting ? "正在验证..." : isRegister ? "创建账号" : "进入工作台"}</button>
        </form>
        <p className="auth-note">密码会经过加盐哈希后保存，不会以明文写入项目。</p>
      </section>
    </main>
  );
}

function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeNav, setActiveNav] = useState<NavKey>("welcome");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileDimension[]>(defaultProfile);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [answerMode, setAnswerMode] = useState<"basic" | "derivation">("basic");
  const [exportScope, setExportScope] = useState<"current" | "selected" | "all">("current");
  const [selectedTurnIds, setSelectedTurnIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountPanel, setAccountPanel] = useState<"settings" | "analytics" | "admin" | null>(null);
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [accountStatus, setAccountStatus] = useState("");
  const [membershipCode, setMembershipCode] = useState("");
  const [adminCodes, setAdminCodes] = useState<MembershipCode[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [codeBatchCount, setCodeBatchCount] = useState(50);
  const [codeQuota, setCodeQuota] = useState(1000000);
  const [isConfigOpen, setConfigOpen] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("等待任务");
  const [model, setModel] = useState("max");
  const [credentials, setCredentials] = useState({ appId: "", apiKey: "", apiSecret: "" });
  const [configTestResult, setConfigTestResult] = useState("");
  const [sessionCount, setSessionCount] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const [pdfReady, setPdfReady] = useState(false);
  const [projectForm, setProjectForm] = useState({ name: "", course: "", description: "" });
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [platformLibrary, setPlatformLibrary] = useState<PlatformLibraryFile[]>([]);
  const [selectedLibraryFiles, setSelectedLibraryFiles] = useState<string[]>([]);
  const [resourcePrompts, setResourcePrompts] = useState<Record<ResourceType, string>>({
    讲义: "",
    思维导图: "",
    题库: "",
    阅读: "",
    实验: "",
  });
  const [resourceCandidates, setResourceCandidates] = useState<Record<ResourceType, string[]>>({
    讲义: [],
    思维导图: [],
    题库: [],
    阅读: [],
    实验: [],
  });
  const [profileSurvey, setProfileSurvey] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem(PROFILE_SURVEY_KEY) || localStorage.getItem(LEGACY_PROFILE_SURVEY_KEY);
    if (saved && !localStorage.getItem(PROFILE_SURVEY_KEY)) {
      localStorage.setItem(PROFILE_SURVEY_KEY, saved);
      localStorage.removeItem(LEGACY_PROFILE_SURVEY_KEY);
    }
    try { return saved ? JSON.parse(saved) : {}; } catch { return {}; }
  });
  const [resourceIndex, setResourceIndex] = useState(0);
  const [candidatePrompts, setCandidatePrompts] = useState<string[]>([]);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const pageScrollLock = useRef(false);
  const pageVisibilityRef = useRef<Map<string, number>>(new Map());
  const animatedPageIdRef = useRef<string | null>(null);
  const pendingPageIdRef = useRef<string | null>(null);
  const candidateJobs = useRef<Map<string, Promise<void>>>(new Map());
  const activeProjectIdRef = useRef<string | null>(null);
  const [agentTrace, setAgentTrace] = useState<AgentTrace[]>(agents.map((agent) => ({ name: agent.name, model: agent.model, status: "待机" })));

  const projects = status?.projects || [];
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || projects[0] || null,
    [projects, activeProjectId],
  );
  const greeting = greetingForHour(new Date().getHours());
  const avatar = resolveAvatar(profileSurvey);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  function preparePageEntrance(page: HTMLElement) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll<HTMLElement>(".snap-page.page-preparing").forEach((item) => item.classList.remove("page-preparing"));
    page.classList.remove("page-entering");
    page.classList.add("page-preparing");
    pendingPageIdRef.current = page.id;
  }

  function goToPage(index: number) {
    const nextIndex = Math.max(0, Math.min(pageRailItems.length - 1, index));
    const next = pageRailItems[nextIndex];
    if (!next) return;
    if (next.key === activeNav && (pageVisibilityRef.current.get(next.target) || 0) >= 0.58) return;
    const root = workspaceRef.current;
    const page = document.getElementById(next.target);
    if (root && page) {
      preparePageEntrance(page);
      root.scrollTo({ top: page.offsetTop, behavior: "smooth" });
    }
    setActiveNav(next.key);
  }

  function jumpToNav(key: NavKey) {
    const targetId = navTargets[key];
    if (key === activeNav && (pageVisibilityRef.current.get(targetId) || 0) >= 0.58) return;
    setActiveNav(key);
    const root = workspaceRef.current;
    const page = document.getElementById(targetId);
    if (root && page) {
      preparePageEntrance(page);
      root.scrollTo({ top: page.offsetTop, behavior: "smooth" });
    }
  }

  async function refreshStatus() {
    const payload = await requestJson<StatusPayload>("/api/status");
    setStatus(payload);
    setActiveProjectId((current) => current || payload.activeProjectId || payload.projects[0]?.id || null);
  }

  async function refreshCurrentUser() {
    const payload = await requestJson<{ user: AuthUser }>("/api/auth/me");
    setCurrentUser(payload.user);
  }

  async function refreshSession(projectId = activeProject?.id) {
    if (!projectId) return;
    const payload = await requestJson<SessionPayload>(`/api/session?projectId=${encodeURIComponent(projectId)}`);
    const items = payload.session.conversations || [];
    setConversations(items);
    setActiveConversationId(payload.session.activeConversationId || items.find((item) => !item.archived)?.id || null);
    setSessionCount(items.reduce((total, item) => total + item.turns.length, 0));
    setPdfReady(payload.pdfReady);
  }

  async function refreshProfile(projectId = activeProject?.id) {
    if (!projectId) return;
    const payload = await requestJson<{ dimensions?: ProfileDimension[]; survey?: Record<string, string> }>(`/api/projects/${encodeURIComponent(projectId)}/profile`);
    setProfile(payload.dimensions?.length ? payload.dimensions : defaultProfile);
    setProfileSurvey(payload.survey || {});
  }

  async function saveProfile(nextProfile = profile, nextSurvey = profileSurvey) {
    if (!activeProject) return;
    const payload = await requestJson<{ dimensions?: ProfileDimension[]; survey?: Record<string, string> }>(`/api/projects/${encodeURIComponent(activeProject.id)}/profile`, {
      method: "PUT", body: JSON.stringify({ dimensions: nextProfile, survey: nextSurvey }),
    });
    setProfile(payload.dimensions?.length ? payload.dimensions : nextProfile);
    setProfileSurvey(payload.survey || nextSurvey);
  }

  useEffect(() => {
    let active = true;
    async function restoreAuth() {
      if (!authToken()) {
        if (active) setAuthReady(true);
        return;
      }
      try {
        const payload = await requestJson<{ user: AuthUser }>("/api/auth/me");
        if (active) setCurrentUser(payload.user);
      } catch {
        localStorage.removeItem(AUTH_TOKEN_KEY);
      } finally {
        if (active) setAuthReady(true);
      }
    }
    restoreAuth();
    const expire = () => {
      setCurrentUser(null);
      setStatus(null);
      setActiveProjectId(null);
      setAuthMode("login");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expire);
    return () => {
      active = false;
      window.removeEventListener(AUTH_EXPIRED_EVENT, expire);
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    refreshStatus()
      .then(async () => {
        const payload = await requestJson<StatusPayload>("/api/status");
        const projectId = payload.activeProjectId || payload.projects[0]?.id;
        if (projectId) await Promise.all([refreshSession(projectId), refreshProfile(projectId)]);
      })
      .catch((error) => setProgressText(error instanceof Error ? error.message : "本地服务未启动"));
    requestJson<{ files: PlatformLibraryFile[] }>("/api/platform-library")
      .then((payload) => setPlatformLibrary(payload.files || []))
      .catch(() => setPlatformLibrary([]));
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await requestJson<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`);
        setSearchResults(result.results);
        setSearchOpen(true);
      } catch (error) {
        setProgressText(error instanceof Error ? error.message : "搜索失败");
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchQuery, currentUser?.id]);

  useEffect(() => {
    if (activeProject?.id) {
      refreshSession(activeProject.id).catch(() => undefined);
      restoreProjectCandidates(activeProject).catch(() => undefined);
    }
  }, [activeProject?.id]);

  useEffect(() => {
    if (!currentUser) return;
    let lastInteractionAt = Date.now();
    const markActive = () => { lastInteractionAt = Date.now(); };
    const heartbeat = () => {
      const isActive = document.visibilityState === "visible" && document.hasFocus() && Date.now() - lastInteractionAt <= 120_000;
      if (isActive) requestJson("/api/activity/heartbeat", { method: "POST" }).catch(() => undefined);
    };
    const activityEvents: (keyof WindowEventMap)[] = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActive, { passive: true }));
    window.addEventListener("focus", markActive);
    heartbeat();
    const timer = window.setInterval(heartbeat, 60_000);
    return () => {
      window.clearInterval(timer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActive));
      window.removeEventListener("focus", markActive);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) return;
    const root = workspaceRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => pageVisibilityRef.current.set(entry.target.id, entry.intersectionRatio));
        const visible = pageRailItems
          .map((item) => ({ item, ratio: pageVisibilityRef.current.get(item.target) || 0 }))
          .sort((a, b) => b.ratio - a.ratio)[0];
        if (!visible) return;
        if (visible.ratio >= 0.42) setActiveNav(visible.item.key);
        const isPendingPage = pendingPageIdRef.current === visible.item.target;
        if (visible.ratio < 0.58 || (!isPendingPage && animatedPageIdRef.current === visible.item.target)) return;

        document.querySelectorAll<HTMLElement>(".snap-page.page-entering").forEach((page) => page.classList.remove("page-entering"));
        const page = document.getElementById(visible.item.target);
        if (!page) return;
        page.classList.remove("page-preparing");
        void page.offsetWidth;
        page.classList.add("page-entering");
        animatedPageIdRef.current = visible.item.target;
        pendingPageIdRef.current = null;
      },
      { root, threshold: [0, 0.2, 0.42, 0.58, 0.72, 0.9] },
    );
    pageRailItems.forEach((item) => {
      const element = document.getElementById(item.target);
      if (element) observer.observe(element);
    });
    return () => {
      observer.disconnect();
      pageVisibilityRef.current.clear();
      animatedPageIdRef.current = null;
      pendingPageIdRef.current = null;
    };
  }, [currentUser]);

  useEffect(() => {
    const root = workspaceRef.current;
    if (!root || !currentUser) return;

    const readCurrentIndex = () => {
      const rootTop = root.getBoundingClientRect().top;
      let nearestIndex = pageIndexForKey(activeNav);
      let nearestDistance = Number.POSITIVE_INFINITY;

      pageRailItems.forEach((item, index) => {
        const element = document.getElementById(item.target);
        if (!element) return;
        const distance = Math.abs(element.getBoundingClientRect().top - rootTop - 92);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      return nearestIndex;
    };

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 14) return;
      if (!root.contains(event.target as Node)) return;

      // Keep dense side panels independently scrollable until they reach an edge.
      const scrollRegion = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".project-items-scroll, .profile-result-panel .profile-list",
      );
      if (scrollRegion) {
        const canScrollDown = scrollRegion.scrollTop + scrollRegion.clientHeight < scrollRegion.scrollHeight - 1;
        const canScrollUp = scrollRegion.scrollTop > 1;
        if ((event.deltaY > 0 && canScrollDown) || (event.deltaY < 0 && canScrollUp)) return;
      }

      const pageRegion = (event.target as HTMLElement | null)?.closest<HTMLElement>(".snap-page");
      if (pageRegion) {
        const pageStyle = window.getComputedStyle(pageRegion);
        const pageCanScroll = pageStyle.overflowY === "auto" || pageStyle.overflowY === "scroll";
        if (pageCanScroll) {
          const canScrollDown = pageRegion.scrollTop + pageRegion.clientHeight < pageRegion.scrollHeight - 1;
          const canScrollUp = pageRegion.scrollTop > 1;
          if ((event.deltaY > 0 && canScrollDown) || (event.deltaY < 0 && canScrollUp)) return;
        }
      }

      event.preventDefault();
      if (pageScrollLock.current) return;

      pageScrollLock.current = true;
      goToPage(readCurrentIndex() + (event.deltaY > 0 ? 1 : -1));
      window.setTimeout(() => {
        pageScrollLock.current = false;
      }, 520);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!["PageDown", "PageUp", "ArrowDown", "ArrowUp"].includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      goToPage(readCurrentIndex() + (event.key === "PageDown" || event.key === "ArrowDown" ? 1 : -1));
    };

    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeNav, currentUser]);

  async function saveCredentials() {
    setBusy(true);
    setConfigTestResult("");
    setProgressText("正在写入运行时模型配置");
    try {
      await requestJson("/api/config", { method: "POST", body: JSON.stringify(credentials) });
      await refreshStatus();
      setConfigOpen(false);
      setProgressText("模型配置已生效");
    } catch (error) {
      setProgressText(error instanceof Error ? error.message : "配置失败");
    } finally {
      setBusy(false);
    }
  }

  async function testSpark() {
    setBusy(true);
    setConfigTestResult("");
    setProgressText("正在测试星火模型连通性");
    try {
      const result = await requestJson<{ ok: boolean; answer: string }>("/api/spark/test", {
        method: "POST",
        body: JSON.stringify({ model }),
      });
      setConfigTestResult(`连接成功：${result.answer || "OK"}`);
      setProgressText("星火模型连通性正常");
    } catch (error) {
      const text = error instanceof Error ? error.message : "连接测试失败";
      setConfigTestResult(text);
      setProgressText(text);
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    if (!projectForm.name.trim() || !projectForm.course.trim()) {
      setProgressText("请填写项目名称和课程名称");
      return;
    }
    if (!selectedFiles?.length && !selectedLibraryFiles.length) {
      setProgressText("请上传自己的 PDF，或至少选择一份平台资料");
      return;
    }
    setBusy(true);
    setProgressText("正在创建学习项目并解析 PDF");
    try {
      const formData = new FormData();
      formData.set("name", projectForm.name);
      formData.set("course", projectForm.course);
      formData.set("description", projectForm.description);
      formData.set("libraryFiles", JSON.stringify(selectedLibraryFiles));
      Array.from(selectedFiles || []).forEach((file) => formData.append("files", file));
      const payload = await requestJson<{ project: Project }>("/api/projects", { method: "POST", body: formData });
      setActiveProjectId(payload.project.id);
      await refreshStatus();
      await refreshSession(payload.project.id);
      await generateAllCandidates(payload.project);
      setSelectedLibraryFiles([]);
      setSelectedFiles(null);
      setProgressText(`项目已创建：${payload.project.files.length} 份资料，${payload.project.chunks} 个切片`);
      jumpToNav("studio");
    } catch (error) {
      setProgressText(error instanceof Error ? error.message : "项目创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function requestCandidates(project: Project, count: number, resourceType?: ResourceType) {
    try {
      const result = await requestJson<PromptResult>("/api/prompts", {
        method: "POST",
        body: JSON.stringify({ course: project.course, description: project.description || "", count, resourceType }),
      });
      return (result.prompts || []).map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const preferred = ["prompt", "question", "text", "content", "requirement", "title"]
            .map((key) => item[key])
            .find((value) => typeof value === "string");
          if (typeof preferred === "string") return preferred.trim();
          const firstText = Object.values(item).find((value) => typeof value === "string");
          return typeof firstText === "string" ? firstText.trim() : "";
        }
        return "";
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function generateAllCandidates(project: Project) {
    const running = candidateJobs.current.get(project.id);
    if (running) return running;
    const job = (async () => {
      const [questions, ...resourceGroups] = await Promise.all([
        requestCandidates(project, 20),
        ...resourceBlueprints.map((item) => requestCandidates(project, 10, item.type)),
      ]);
      const resources = Object.fromEntries(resourceBlueprints.map((item, index) => [item.type, resourceGroups[index] || []])) as Record<ResourceType, string[]>;
      const bundle = { questions, resources };
      if (activeProjectIdRef.current === project.id) {
        setCandidatePrompts(bundle.questions);
        setResourceCandidates(bundle.resources);
      }
      await requestJson(`/api/projects/${encodeURIComponent(project.id)}/candidates`, {
        method: "PUT",
        body: JSON.stringify(bundle),
      }).catch(() => undefined);
      await refreshCurrentUser().catch(() => undefined);
    })();
    candidateJobs.current.set(project.id, job);
    try {
      await job;
    } finally {
      candidateJobs.current.delete(project.id);
    }
  }

  async function restoreProjectCandidates(project: Project) {
    try {
      const bundle = await requestJson<CandidateBundle>(`/api/projects/${encodeURIComponent(project.id)}/candidates`);
      if (bundle.questions?.length || Object.values(bundle.resources || {}).some((items) => items?.length)) {
        if (activeProjectIdRef.current === project.id) {
          setCandidatePrompts(bundle.questions || []);
          setResourceCandidates({
            讲义: bundle.resources?.讲义 || [],
            思维导图: bundle.resources?.思维导图 || [],
            题库: bundle.resources?.题库 || [],
            阅读: bundle.resources?.阅读 || [],
            实验: bundle.resources?.实验 || [],
          });
        }
        return;
      }
    } catch {
      // Older projects do not have a saved candidate bundle yet.
    }
    await generateAllCandidates(project);
  }

  async function switchProject(projectId: string) {
    setActiveProjectId(projectId);
    setAnswer("");
    setEvidence([]);
    setSelectedEvidence(null);
    setProfile(defaultProfile);
    setProfileSurvey({});
    setPdfReady(false);
    const project = projects.find((item) => item.id === projectId);
    if (project) await restoreProjectCandidates(project);
    await Promise.all([refreshSession(projectId), refreshProfile(projectId)]).catch(() => undefined);
  }

  async function rebuildProject(projectId: string) {
    setBusy(true);
    setProgressText("正在按页重建知识库索引");
    try {
      const payload = await requestJson<{ project: Project }>(`/api/projects/${encodeURIComponent(projectId)}/rebuild`, { method: "POST" });
      await refreshStatus();
      setActiveProjectId(payload.project.id);
      setProgressText(`索引已重建：${payload.project.files.length} 份资料，${payload.project.chunks} 个按页切片`);
    } catch (error) {
      setProgressText(error instanceof Error ? error.message : "重建索引失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(project: Project) {
    const confirmed = window.confirm(`确认删除学习项目“${project.name}”吗？\n\n项目资料、知识库索引、问答记录和导出文件都会被永久删除。`);
    if (!confirmed) return;
    setBusy(true);
    setProgressText(`正在删除项目：${project.name}`);
    try {
      await requestJson(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      candidateJobs.current.delete(project.id);
      if (activeProjectIdRef.current === project.id) {
        setActiveProjectId(null);
        setAnswer("");
        setEvidence([]);
        setSelectedEvidence(null);
        setCandidatePrompts([]);
        setResourceCandidates({ 讲义: [], 思维导图: [], 题库: [], 阅读: [], 实验: [] });
        setSessionCount(0);
        setPdfReady(false);
      }
      await refreshStatus();
      setProgressText(`项目“${project.name}”已删除`);
    } catch (error) {
      setProgressText(error instanceof Error ? error.message : "删除项目失败");
    } finally {
      setBusy(false);
    }
  }

  async function runAgents(nextMessage = message, resourceType?: ResourceType) {
    if (!activeProject) {
      setProgressText("请先新建或选择一个学习项目");
      jumpToNav("projects");
      return;
    }
    const userMessage = nextMessage.trim();
    if (!userMessage) {
      setProgressText("请输入本次要生成或解答的要求");
      return;
    }
    setBusy(true);
    setAnswer("");
    setEvidence([]);
    setProgressText(resourceType ? `${resourceType}智能体正在接收要求` : "画像智能体正在分析学习需求");
    setAgentTrace(agents.map((agent, index) => ({ name: agent.name, model: agent.model, status: index < 2 ? "运行中" : "排队" })));
    try {
      window.setTimeout(() => setProgressText("检索智能体正在读取课程证据"), 450);
      window.setTimeout(() => setProgressText(resourceType ? `${resourceType}资源正在生成` : "讲解、路径与训练智能体正在协作"), 900);
      const result = await requestJson<ChatResult>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ projectId: activeProject.id, message: userMessage, model, resourceType, answerMode, conversationId: activeConversationId, profileSurvey, profileText: Object.entries(profileSurvey).map(([key, value]) => `${key}: ${value}`).join("\n") }),
      });
      setAnswer(result.answer);
      setEvidence(result.evidence || []);
      setSelectedEvidence(result.evidence?.[0] || null);
      setProfile(result.profile?.length ? result.profile : defaultProfile);
      setSessionCount(result.sessionCount || sessionCount);
      if (result.activeConversationId) setActiveConversationId(result.activeConversationId);
      if (result.profileChanges?.length) setProgressText(`画像已更新：${result.profileChanges.map((item) => `${item.label}·${item.value}`).join("；")}`);
      await refreshSession(activeProject.id);
      if (result.membership) {
        setCurrentUser((user) => user ? { ...user, membership: result.membership! } : user);
      }
      setAgentTrace(result.agentTrace || agents.map((agent) => ({ name: agent.name, model: agent.model, status: "完成" })));
      setProgressText(result.usedSpark ? "已由星火模型生成并完成证据绑定" : "已使用本地检索兜底生成");
      setPdfReady(false);
      jumpToNav(resourceType ? "resources" : "studio");
    } catch (error) {
      setProgressText(error instanceof Error ? error.message : "生成失败");
      setAgentTrace(agents.map((agent) => ({ name: agent.name, model: agent.model, status: "中止" })));
    } finally {
      setBusy(false);
    }
  }

  async function buildInitialProfile() {
    const nextProfile = [
      { label: "知识基础", value: profileSurvey.level || "未填写" },
      { label: "学习目标", value: profileSurvey.goal || "未填写" },
      { label: "认知风格", value: profileSurvey.style || "未填写" },
      { label: "资源偏好", value: profileSurvey.style === "代码实验" ? "实验与代码优先" : profileSurvey.style || "未填写" },
      { label: "薄弱点", value: projectForm.description || activeProject?.description || "后续通过问答继续定位" },
      { label: "反馈节奏", value: profileSurvey.pace || "未填写" },
    ];
    setProfile(nextProfile);
    await saveProfile(nextProfile, profileSurvey);
    setProgressText("初始画像已建立，后续问答会继续补充画像");
  }

  async function compileSessionPdf() {
    if (!activeProject) return;
    setBusy(true);
    setExportStatus("正在生成 TeX 并尝试编译 PDF");
    try {
      const result = await requestJson<{ ok: boolean; pdfUrl?: string }>(
        `/api/session/compile?${exportParams.toString()}`,
        { method: "POST" },
      );
      setExportStatus("PDF 编译完成，可以点击下载 PDF");
      setPdfReady(Boolean(result.pdfUrl));
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "PDF 编译失败，已保留 TeX 文件");
      setPdfReady(false);
    } finally {
      setBusy(false);
    }
  }

  async function resetSession() {
    if (!activeProject) return;
    setBusy(true);
    setExportStatus("正在清空当前项目学习记录");
    try {
      await requestJson(`/api/session/reset?projectId=${encodeURIComponent(activeProject.id)}`, { method: "POST" });
      setSessionCount(0);
      setPdfReady(false);
      setExportStatus("当前项目学习记录已清空");
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "清空失败");
    } finally {
      setBusy(false);
    }
  }

  async function createConversation() {
    if (!activeProject) return;
    try {
      const payload = await requestJson<SessionPayload>(`/api/session/conversations?projectId=${encodeURIComponent(activeProject.id)}`, { method: "POST", body: JSON.stringify({ title: "新建学习会话" }) });
      const items = payload.session.conversations || [];
      setConversations(items); setActiveConversationId(payload.session.activeConversationId || null); setMessage(""); setAnswer("");
    } catch (error) { setProgressText(error instanceof Error ? error.message : "新建会话失败"); }
  }

  async function updateConversation(conversationId: string, updates: Partial<Pick<Conversation, "title" | "archived">>) {
    if (!activeProject) return;
    try {
      const payload = await requestJson<SessionPayload>(`/api/session/conversations/${encodeURIComponent(conversationId)}?projectId=${encodeURIComponent(activeProject.id)}`, { method: "PUT", body: JSON.stringify(updates) });
      setConversations(payload.session.conversations || []); setActiveConversationId(payload.session.activeConversationId || null);
    } catch (error) { setProgressText(error instanceof Error ? error.message : "更新会话失败"); }
  }

  async function activateConversation(conversationId: string) {
    if (!activeProject) return;
    const payload = await requestJson<SessionPayload>(`/api/session/conversations/${encodeURIComponent(conversationId)}/activate?projectId=${encodeURIComponent(activeProject.id)}`, { method: "POST" });
    setConversations(payload.session.conversations || []); setActiveConversationId(payload.session.activeConversationId || conversationId); setAnswer("");
  }

  const activeConversation = conversations.find((item) => item.id === activeConversationId) || null;
  const exportTurns = exportScope === "current" ? (activeConversation?.turns.slice(-1) || []) : exportScope === "selected" ? conversations.flatMap((item) => item.turns).filter((item) => selectedTurnIds.includes(item.id)) : conversations.flatMap((item) => item.turns);
  const exportParams = new URLSearchParams({ projectId: activeProject?.id || "" });
  if (exportScope !== "all" && activeConversationId) exportParams.set("conversationId", activeConversationId);
  if (exportScope === "selected") exportParams.set("turnIds", selectedTurnIds.join(","));

  const tokenParam = encodeURIComponent(authToken());
  exportParams.set("token", tokenParam);
  const texUrl = activeProject ? `${API_BASE}/api/session/tex?${exportParams.toString()}` : "#";
  const markdownUrl = activeProject ? `${API_BASE}/api/session/markdown?${exportParams.toString()}` : "#";
  const pdfUrl = activeProject ? `${API_BASE}/api/session/pdf?projectId=${encodeURIComponent(activeProject.id)}&token=${tokenParam}` : "#";

  async function enterWorkspace(values: { name: string; email: string; password: string }) {
    const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const result = await requestJson<AuthResult>(endpoint, { method: "POST", body: JSON.stringify(values) });
    localStorage.setItem(AUTH_TOKEN_KEY, result.token);
    setCurrentUser(result.user);
    setStatus(null);
    setActiveProjectId(null);
  }

  async function signOut() {
    await requestJson("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setCurrentUser(null);
    setStatus(null);
    setActiveProjectId(null);
    setAuthMode("login");
  }

  async function openAccountPanel(panel: "settings" | "analytics" | "admin") {
    setAccountMenuOpen(false);
    setAccountPanel(panel);
    setAccountStatus("");
    if (panel === "analytics") {
      try {
        setActivitySummary(await requestJson<ActivitySummary>("/api/activity/summary"));
      } catch (error) {
        setAccountStatus(error instanceof Error ? error.message : "无法读取使用数据");
      }
    }
    if (panel === "admin") await loadAdminData();
  }

  async function redeemMembership() {
    try {
      const payload = await requestJson<{ user: AuthUser }>("/api/auth/redeem", { method: "POST", body: JSON.stringify({ code: membershipCode }) });
      setCurrentUser(payload.user);
      setMembershipCode("");
      setAccountStatus("会员码兑换成功，额度已经到账。");
    } catch (error) {
      setAccountStatus(error instanceof Error ? error.message : "会员码兑换失败");
    }
  }

  async function loadAdminData() {
    try {
      const [codes, users] = await Promise.all([
        requestJson<{ codes: MembershipCode[] }>("/api/admin/codes"),
        requestJson<{ users: AdminUser[] }>("/api/admin/users"),
      ]);
      setAdminCodes(codes.codes);
      setAdminUsers(users.users);
    } catch (error) {
      setAccountStatus(error instanceof Error ? error.message : "管理员数据读取失败");
    }
  }

  async function createCodeBatch() {
    try {
      const payload = await requestJson<{ codes: MembershipCode[] }>("/api/admin/codes", { method: "POST", body: JSON.stringify({ count: codeBatchCount, quotaTokens: codeQuota }) });
      setAdminCodes((current) => [...payload.codes, ...current]);
      const copied = await copyText(payload.codes.map((item) => item.code).join("\n"));
      setAccountStatus(copied
        ? `已生成 ${payload.codes.length} 个会员码，并复制到剪贴板。`
        : `已生成 ${payload.codes.length} 个会员码。当前浏览器禁止自动复制，请点击下方会员码逐个复制。`);
    } catch (error) {
      setAccountStatus(error instanceof Error ? error.message : "会员码生成失败");
    }
  }

  async function changePassword() {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setAccountStatus("两次输入的新密码不一致。");
      return;
    }
    try {
      await requestJson("/api/auth/change-password", { method: "POST", body: JSON.stringify(passwordForm) });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setAccountStatus("密码已更新，其他设备上的登录已失效。");
    } catch (error) {
      setAccountStatus(error instanceof Error ? error.message : "密码修改失败");
    }
  }

  async function chooseSearchResult(result: SearchResult) {
    await switchProject(result.projectId);
    setSearchOpen(false);
    setSearchQuery("");
    if (result.type === "project") {
      jumpToNav("projects");
      return;
    }
    const item: Evidence = {
      id: `search:${result.projectId}:${result.source}:${result.page}`,
      source: result.source || "",
      name: result.title,
      chunkIndex: 0,
      text: result.excerpt || "",
      score: 1,
      page: result.page || 1,
    };
    setSelectedEvidence(item);
    setEvidence([item]);
    jumpToNav("evidence");
  }

  const activityDays = useMemo(() => {
    const byDate = new Map((activitySummary?.days || []).map((item) => [item.date, item.minutes]));
    return Array.from({ length: 84 }, (_, index) => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - (83 - index));
      const key = date.toLocaleDateString("en-CA");
      return { date: key, minutes: byDate.get(key) || 0 };
    });
  }, [activitySummary]);

  const hourCurve = useMemo(() => {
    const hours = activitySummary?.hours || Array(24).fill(0);
    const max = Math.max(1, ...hours);
    return hours.map((value, hour) => `${hour === 0 ? "M" : "L"} ${hour * (720 / 23)} ${128 - (value / max) * 96}`).join(" ");
  }, [activitySummary]);

  if (!authReady) return <main className="auth-loading">正在恢复登录状态...</main>;
  if (!currentUser) {
    return <AuthScreen mode={authMode} onModeChange={setAuthMode} onSubmit={enterWorkspace} />;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <img className="brand-mark brand-logo" src="/LOGO.png" alt="OmniLearn | MAS" />
          <div>
            <strong>OmniLearn | MAS</strong>
            <span>个性化学习工作台</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button className={activeNav === item.key ? "nav-item active" : "nav-item"} key={item.key} onClick={() => jumpToNav(item.key)}>
              <span className="nav-glyph">{item.label.slice(0, 1)}</span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="model-card">
          <span>运行状态</span>
          <strong>{status?.sparkConfigured ? "星火模型已连接" : "本地检索模式"}</strong>
          <p>{progressText}</p>
        </div>
      </aside>

      <nav className="page-rail" aria-label="页面分段导航">
        {pageRailItems.map((item) => (
          <button
            className={activeNav === item.key ? "page-rail-item active" : "page-rail-item"}
            key={item.target}
            onClick={() => {
              goToPage(pageIndexForKey(item.key));
            }}
            type="button"
          >
            <span />
            <strong>{item.label}</strong>
          </button>
        ))}
      </nav>

      <div className="main-column">
        <header className="topbar">
          <div>
            <span className="page-kicker">Personal Learning Workspace</span>
            <h1>{activeProject ? activeProject.name : "创建一个课程学习项目"}</h1>
            <p>{activeProject ? `${activeProject.course} · ${activeProject.files.length} 份资料 · ${activeProject.chunks} 个证据切片` : "上传课程资料，建立可追溯的个性化学习空间。"}</p>
          </div>
          <div className="top-search" role="search">
            <span aria-hidden="true">⌕</span>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onFocus={() => searchResults.length && setSearchOpen(true)} placeholder="搜索学习项目、资料或知识点..." aria-label="搜索学习项目、资料或知识点" />
            {searching && <small>检索中</small>}
            {searchOpen && (
              <div className="search-results">
                <div className="search-results-head"><strong>搜索结果</strong><span>{searchResults.length} 项</span></div>
                {searchResults.length ? searchResults.map((result, index) => (
                  <button type="button" key={`${result.type}-${result.projectId}-${result.source || index}-${result.page || 0}`} onClick={() => chooseSearchResult(result)}>
                    <span className={`search-kind ${result.type}`}>{result.type === "project" ? "项目" : result.type === "file" ? "资料" : "知识"}</span>
                    <span className="search-copy"><strong>{result.title}</strong><small>{result.subtitle}</small>{result.excerpt && <em>{result.excerpt}</em>}</span>
                  </button>
                )) : <p>没有找到匹配内容，换一个关键词试试。</p>}
              </div>
            )}
          </div>
          <div className="top-actions">
            {currentUser.role === "admin" && import.meta.env.DEV && <button className="secondary-btn" onClick={() => setConfigOpen(true)}>模型配置</button>}
            <a className="secondary-btn as-link" href={texUrl}>下载 TeX</a>
            <button className="secondary-btn" onClick={compileSessionPdf} disabled={isBusy || !activeProject}>编译 PDF</button>
            <button className="text-btn" onClick={resetSession} disabled={isBusy || !activeProject}>清空记录</button>
            <div className="account-control">
              <button className="user-chip" type="button" onClick={() => setAccountMenuOpen((open) => !open)} aria-expanded={accountMenuOpen} title="账户与工作台">
                <span>{currentUser.name.slice(0, 1).toUpperCase()}</span>
                <strong>{currentUser.name}</strong>
                <b aria-hidden="true">⌄</b>
              </button>
              {accountMenuOpen && (
                <div className="account-menu">
                  <div className="account-menu-user"><span>{currentUser.name.slice(0, 1).toUpperCase()}</span><div><strong>{currentUser.name}</strong><small>{currentUser.email}</small></div></div>
                  <button type="button" onClick={() => openAccountPanel("settings")}><span className="account-menu-icon">◎</span><span><strong>账号设置</strong><small>密码、安全与退出登录</small></span><b>›</b></button>
                  <button type="button" onClick={() => openAccountPanel("analytics")}><span className="account-menu-icon">⌁</span><span><strong>工作台数据</strong><small>活跃时长与集中时段</small></span><b>›</b></button>
                  {currentUser.role === "admin" && <button type="button" onClick={() => openAccountPanel("admin")}><span className="account-menu-icon">◇</span><span><strong>会员管理</strong><small>发码、额度与试用统计</small></span><b>›</b></button>}
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="workspace" ref={workspaceRef}>
        <section className="snap-page welcome-page" id="welcome-section">
          <div className="dashboard-hero">
            <div className="welcome-copy">
              <div className="welcome-brand-line"><img src="/LOGO.png" alt="OmniLearn | MAS" /><span>AI 导师</span></div>
              <h2>{greeting.title}，{currentUser.name}</h2>
              <div className="welcome-notes">
                <p>{greeting.note}</p>
                <p>系统会把问答自动沉淀为可导出的学习记录</p>
              </div>
              <div className="hero-actions">
                <button className="hero-action" type="button" onClick={() => jumpToNav("studio")}>开始对话</button>
                <button className="hero-action hero-action-quiet" type="button" onClick={() => jumpToNav("profile")}>建立初始画像</button>
              </div>
            </div>
            {avatar ? (
              <aside className="welcome-avatar-stage">
                <img src={avatar.src} alt={avatar.archetype} />
                <div><span>你的学习形象</span><strong>{avatar.archetype}</strong></div>
              </aside>
            ) : (
              <aside>
                <strong>建立专属学习形象</strong>
                <p>完成初始画像问卷后，系统会根据你的学习方式匹配形象。</p>
              </aside>
            )}
          </div>
        </section>
        <section className="snap-page project-page" id="projects-section">
        <div className="dashboard-hero">
          <div>
            <span>AI 导师</span>
            <h2>晚上好，{currentUser.name}</h2>
            <p>
              今天可以从课程资料、薄弱点诊断或资源生成开始
              <br />
              系统会把问答自动沉淀为可导出的学习记录
            </p>
            <div className="hero-actions">
              <button className="hero-action" type="button" onClick={() => jumpToNav("studio")}>开始对话</button>
              <button className="hero-action hero-action-quiet" type="button" onClick={() => jumpToNav("profile")}>建立初始画像</button>
            </div>
          </div>
          <aside>
            <strong>今日建议</strong>
            <p>{activeProject ? `继续完善「${activeProject.name}」的知识库与学习画像。` : "先创建一个学习项目并上传课程 PDF。"}</p>
          </aside>
        </div>

        <section className="project-board">
          <article className="panel project-create">
            <div className="panel-heading">
              <div>
                <span>Learning Project</span>
                <h3>新建学习项目</h3>
              </div>
              <b className="soft-badge">本地保存</b>
            </div>
            <div className="project-form">
              <label>项目名称<input value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} /></label>
              <label>课程名称<input value={projectForm.course} onChange={(event) => setProjectForm({ ...projectForm, course: event.target.value })} /></label>
              <label className="wide-field">学习目标<textarea value={projectForm.description} onChange={(event) => setProjectForm({ ...projectForm, description: event.target.value })} placeholder="例：准备期末复习，重点补齐核心概念、公式推导和综合应用。" /></label>
              <fieldset className="wide-field source-picker">
                <legend>课程资料来源</legend>
                <div className="source-block">
                  <div><strong>上传自己的资料</strong><span>支持同时选择多个 PDF</span></div>
                  <label className="file-drop">选择 PDF<input type="file" accept="application/pdf" multiple onChange={(event) => setSelectedFiles(event.target.files)} /></label>
                </div>
                <div className="source-block platform-source">
                  <div><strong>使用平台资料库</strong><span>可多选，也可以与自己的资料一起建库</span></div>
                  <div className="platform-file-list">
                    {platformLibrary.length ? platformLibrary.map((file) => {
                      const checked = selectedLibraryFiles.includes(file.id);
                      return (
                        <label className={checked ? "platform-file selected" : "platform-file"} key={file.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelectedLibraryFiles((current) => checked ? current.filter((id) => id !== file.id) : [...current, file.id])}
                          />
                          <span><strong>{file.name.replace(/\.pdf$/i, "")}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB · PDF</small></span>
                        </label>
                      );
                    }) : <p>平台资料正在加载，仍可上传自己的 PDF。</p>}
                  </div>
                </div>
              </fieldset>
            </div>
            <button className="primary-btn" onClick={createProject} disabled={isBusy}>创建并构建知识库</button>
          </article>

          <article className="panel project-list">
            <div className="panel-heading">
              <div>
                <span>Local Library</span>
                <h3>已有项目</h3>
              </div>
              <b className="soft-badge">{projects.length} 个</b>
            </div>
            <div className="project-items project-items-scroll">
              {projects.length ? projects.map((project) => (
                <article className={activeProject?.id === project.id ? "project-item selected" : "project-item"} key={project.id}>
                  <button className="project-select" onClick={() => switchProject(project.id)}>
                    <strong>{project.name}</strong>
                    <span>{project.course} · {project.files.length} 份资料 · {project.chunks} 切片</span>
                    <small>更新于 {formatTime(project.updatedAt)}</small>
                  </button>
                  <div className="project-actions">
                    <button className="mini-btn" onClick={() => rebuildProject(project.id)} disabled={isBusy}>按页重建索引</button>
                    <button className="mini-btn danger-btn" onClick={() => deleteProject(project)} disabled={isBusy}>删除项目</button>
                  </div>
                </article>
              )) : <p className="empty-copy">还没有项目。先上传一组 PDF，系统会自动解析并建立 RAG 索引。</p>}
            </div>
          </article>
        </section>
        </section>

        <section className="stage snap-page" id="studio-section">
          <article className="conversation-panel">
            <div className="panel-heading">
              <div>
                <span>Conversation</span>
                <h3>学习问答</h3>
              </div>
              <select value={model} onChange={(event) => setModel(event.target.value)} aria-label="模型">
                <option value="max">Spark X2</option>
                <option value="pro">Spark X1.5</option>
              </select>
            </div>
            <div className="conversation-tools">
              <div className="conversation-list" aria-label="问答会话存档">
                <button type="button" className="mini-btn" onClick={createConversation} disabled={!activeProject}>＋ 新会话</button>
                {conversations.filter((item) => !item.archived).map((item) => (
                  <div className={item.id === activeConversationId ? "conversation-chip active" : "conversation-chip"} key={item.id}>
                    <button type="button" onClick={() => activateConversation(item.id)}>{item.title}</button>
                    <button type="button" title="重命名" onClick={() => { const title = window.prompt("会话名称", item.title); if (title) updateConversation(item.id, { title }); }}>✎</button>
                    <button type="button" title="归档" onClick={() => updateConversation(item.id, { archived: true })}>⌁</button>
                  </div>
                ))}
              </div>
              <div className="answer-mode" role="group" aria-label="答疑模式">
                <button type="button" className={answerMode === "basic" ? "active" : ""} onClick={() => setAnswerMode("basic")}>通俗基础讲解</button>
                <button type="button" className={answerMode === "derivation" ? "active" : ""} onClick={() => setAnswerMode("derivation")}>深度公式推导</button>
              </div>
            </div>
            <textarea className="composer" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={activeProject ? `围绕“${activeProject.course}”输入你的学习问题` : "请先新建或选择学习项目"} />
            {candidatePrompts.length > 0 && (
              <div className="candidate-prompts">
                <div className="candidate-prompts-track">
                  {[...candidatePrompts, ...candidatePrompts].map((prompt, index) => (
                    <button
                      key={`${index}-${prompt}`}
                      style={{ width: `${candidateWidth(prompt)}px` }}
                      title={prompt}
                      onClick={() => setMessage(prompt)}
                      disabled={isBusy}
                    >{prompt}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="action-row">
              <button className="primary-btn" onClick={() => runAgents()} disabled={isBusy || !activeProject}>启动问答</button>
              <span>{activeProject ? `${activeConversation?.title || "新会话"} · 问答会自动写入项目学习记录` : "请先选择学习项目"}</span>
            </div>
          </article>

          <aside className="profile-rail legacy-profile-panel" id="profile-section" hidden>
            <div className="rail-head">
              <h3>动态学习画像</h3>
              <span>{profile.length} 维</span>
            </div>
            <div className="profile-survey">
              <strong>初始基础画像</strong>
              {profileQuestions.map((question) => (
                <label key={question.key}>
                  {question.label}
                  <select value={profileSurvey[question.key] || ""} onChange={(event) => setProfileSurvey({ ...profileSurvey, [question.key]: event.target.value })}>
                    <option value="">请选择</option>
                    {question.options.map((option) => <option value={option} key={option}>{option}</option>)}
                  </select>
                </label>
              ))}
              <button className="secondary-btn" onClick={buildInitialProfile}>建立初始画像</button>
            </div>
            <div className="profile-list">
              {profile.map((item) => (
                <article className="profile-item" key={item.label}>
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                </article>
              ))}
            </div>
          </aside>
        </section>

        <section className="profile-page snap-page" id="profile-page-section">
          <article className="profile-intro">
            <span className="page-kicker">Learning Profile</span>
            <h2>先让系统认识你，再开始学习</h2>
            <p>用几项选择建立初始画像。后续问答、练习和资源反馈会继续修正它。</p>
          </article>
          <div className="profile-layout">
            <article className="panel profile-survey-panel">
              <div className="panel-heading">
                <div><span>Baseline Survey</span><h3>初始基础画像</h3></div>
                <b className="soft-badge">{profileQuestions.length} 项</b>
              </div>
              <div className="profile-survey-grid">
                {profileQuestions.map((question) => (
                  <label key={question.key}>
                    <span>{question.label}</span>
                    <select value={profileSurvey[question.key] || ""} onChange={(event) => setProfileSurvey({ ...profileSurvey, [question.key]: event.target.value })}>
                      <option value="">请选择</option>
                      {question.options.map((option) => <option value={option} key={option}>{option}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <button className="primary-btn" onClick={buildInitialProfile}>建立初始画像</button>
            </article>
            <article className="panel profile-result-panel">
              <div className="panel-heading">
                <div><span>Dynamic Signal</span><h3>动态学习画像</h3></div>
                <b className="soft-badge">{profile.length} 维</b>
              </div>
              <RadarProfile profile={profile} />
              <div className="profile-list profile-edit-list">
                {profile.map((item) => (
                  <article className="profile-item" key={item.label}>
                    <div><strong>{item.label}</strong><span>{item.value}</span></div>
                    <select value={item.value} onChange={(event) => {
                      const next = profile.map((entry) => entry.label === item.label ? { ...entry, value: event.target.value, manual: true } : entry);
                      setProfile(next); saveProfile(next);
                    }}>
                      <option value={item.value}>{item.value}</option>
                      {item.label === "知识基础" && ["刚入门，需要概念澄清", "学过但不稳", "能做基础题", "准备冲刺提高题"].map((value) => <option value={value} key={value}>{value}</option>)}
                      {item.label === "认知风格" && ["关系图 + 例子优先", "定义、推导、例题并行", "公式推导优先", "代码实验优先"].map((value) => <option value={value} key={value}>{value}</option>)}
                      {item.label === "薄弱点" && ["概念边界与术语区分", "公式推导", "典型例题", "工程应用"].map((value) => <option value={value} key={value}>{value}</option>)}
                    </select>
                  </article>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className="studio-grid snap-page output-page" id="output-section">
          <article className="panel output-panel">
            <div className="panel-heading">
              <div>
                <span>Generated Workspace</span>
                <h3>生成结果</h3>
              </div>
              <b className="soft-badge">{isBusy ? "生成中" : "可用"}</b>
            </div>
            <div className="markdown-output">
              {answer ? renderMarkdown(answer) : <p>选择项目后输入问题，系统会在这里渲染 Markdown、LaTeX 公式、Mermaid 图谱和代码块。引用来源会在右侧单独展示。</p>}
            </div>
          </article>

          <article className="panel agent-panel output-agent-hidden">
            <div className="panel-heading">
              <div>
                <span>Agent Trace</span>
                <h3>智能体分工</h3>
              </div>
            </div>
            <div className="agent-flow">
              {agentTrace.map((agent) => (
                <article className="agent-node" key={agent.name}>
                  <div>
                    <strong>{agent.name}</strong>
                    <span>{agents.find((item) => item.name === agent.name)?.role || "任务处理"}</span>
                  </div>
                  <b>{agent.model}</b>
                  <small>{agent.status}</small>
                </article>
              ))}
            </div>
          </article>
        </section>

        <section className="resource-section snap-page" id="resources-section">
          <div className="section-heading">
            <div>
              <span>Learning Assets</span>
              <h3>专项资源生成</h3>
            </div>
            <p>每个资源有独立输入框和生成按钮，只生成你选择的那一种资源。</p>
          </div>
          <div className="resource-carousel">
            <button className="resource-arrow" type="button" onClick={() => setResourceIndex((index) => (index + resourceBlueprints.length - 1) % resourceBlueprints.length)} aria-label="上一个资源">←</button>
            {(() => {
              const item = resourceBlueprints[resourceIndex];
              return <article className="resource-card resource-card-featured" key={item.type}>
                <div className="resource-meta">
                  <span>{item.type}</span>
                  <b>{item.model}</b>
                </div>
                <h4>{item.title}</h4>
                <p>{item.desc}</p>
                <textarea
                  value={resourcePrompts[item.type]}
                  onChange={(event) => setResourcePrompts({ ...resourcePrompts, [item.type]: event.target.value })}
                  placeholder={resourcePlaceholder(item.type, activeProject?.course, resourceCandidates[item.type][0])}
                />
                {resourceCandidates[item.type].length > 0 && (
                  <div className="resource-candidates">
                    <div className="resource-candidates-track">
                      {[...resourceCandidates[item.type], ...resourceCandidates[item.type]].map((prompt, index) => (
                        <button type="button" key={`${item.type}-${index}-${prompt}`} onClick={() => setResourcePrompts({ ...resourcePrompts, [item.type]: prompt })}>{prompt}</button>
                      ))}
                    </div>
                  </div>
                )}
                <button className="resource-action" disabled={isBusy || !activeProject} onClick={() => runAgents(resourcePrompts[item.type], item.type)}>
                  生成{item.type}
                </button>
              </article>;
            })()}
            <button className="resource-arrow" type="button" onClick={() => setResourceIndex((index) => (index + 1) % resourceBlueprints.length)} aria-label="下一个资源">→</button>
          </div>
        </section>

        <section className="evidence-export-grid snap-page" id="evidence-page">
          <article className="panel evidence-panel" id="evidence-section">
            <div className="panel-heading">
              <div>
                <span>Grounded Evidence</span>
                <h3>引用与原文预览</h3>
              </div>
              <b className="soft-badge">{evidence.length} 条</b>
            </div>
            <div className="evidence-list">
              {evidence.length ? evidence.map((item, index) => (
                <button
                  className={selectedEvidence?.id === item.id ? "evidence-item selected" : "evidence-item"}
                  key={item.id}
                  onClick={() => setSelectedEvidence(item)}
                >
                  <strong>引用 [{index + 1}]</strong>
                  <span>第 {item.page || 1} 页 / 切片 {item.chunkIndex + 1}</span>
                </button>
              )) : <p className="empty-copy">生成后会显示引用的课件切片。点击任意引用，右侧会定位到对应 PDF 页面。</p>}
            </div>
            {selectedEvidence && (
              <div className="pdf-preview">
                <div className="pdf-preview-head">
                  <strong>引用原文预览：第 {selectedEvidence.page || 1} 页</strong>
                  <a href={`${API_BASE}/api/pdf?projectId=${encodeURIComponent(activeProject?.id || "")}&source=${encodeURIComponent(selectedEvidence.source)}&token=${tokenParam}#page=${selectedEvidence.page || 1}`} target="_blank" rel="noreferrer">
                    新窗口打开
                  </a>
                </div>
                <iframe
                  key={`${selectedEvidence.source}-${selectedEvidence.page || 1}`}
                  title="引用 PDF 预览"
                  src={`${API_BASE}/api/pdf?projectId=${encodeURIComponent(activeProject?.id || "")}&source=${encodeURIComponent(selectedEvidence.source)}&token=${tokenParam}#page=${selectedEvidence.page || 1}`}
                />
              </div>
            )}
          </article>

          <article className="panel export-panel" id="export-section">
            <div className="panel-heading">
              <div>
                <span>Session Export</span>
                <h3>学习记录导出</h3>
              </div>
              <b className="soft-badge">{sessionCount} 轮</b>
            </div>
            <div className="export-actions">
              <div className="export-scope" role="group" aria-label="导出范围">
                <button type="button" className={exportScope === "current" ? "active" : ""} onClick={() => setExportScope("current")}>当前轮</button>
                <button type="button" className={exportScope === "selected" ? "active" : ""} onClick={() => setExportScope("selected")}>勾选轮次</button>
                <button type="button" className={exportScope === "all" ? "active" : ""} onClick={() => setExportScope("all")}>全部项目</button>
              </div>
              <a className="secondary-btn as-link" href={texUrl}>下载 TeX</a>
              <a className="secondary-btn as-link" href={markdownUrl}>下载 Markdown</a>
              <button className="primary-btn" onClick={compileSessionPdf} disabled={isBusy || !activeProject}>编译 PDF</button>
              <a className={pdfReady ? "secondary-btn as-link" : "secondary-btn as-link disabled"} href={pdfReady ? pdfUrl : "#"}>下载 PDF</a>
            </div>
            {exportScope === "selected" && <div className="export-turns">{conversations.flatMap((item) => item.turns).map((turn, index) => <label key={turn.id}><input type="checkbox" checked={selectedTurnIds.includes(turn.id)} onChange={() => setSelectedTurnIds((ids) => ids.includes(turn.id) ? ids.filter((id) => id !== turn.id) : [...ids, turn.id])} />第 {index + 1} 轮：{turn.question}</label>)}</div>}
            <p>{exportStatus || "每轮问题、答案、针对性练习题与引用都会写入当前项目的 TeX 文件。编译成功后这里会出现 PDF 下载入口。"}</p>
            <div className="safety-stack">
              <div><strong>公式清洗</strong><span>保留 $...$ 与 $$...$$，清除 Markdown 标记残留。</span></div>
              <div><strong>资源入册</strong><span>问答与专项资源都会写入同一个学习记录。</span></div>
              <div><strong>引用可追踪</strong><span>TeX 中记录引用序号、真实页码和切片编号。</span></div>
            </div>
          </article>
        </section>

        <section className="system-page snap-page" id="system-section">
          <article className="system-agents panel">
            <div className="section-heading">
              <div><span>System Design</span><h3>智能体协作分工</h3></div>
              <p>从画像、检索到生成与安全校验，所有角色在同一学习项目中协同工作。</p>
            </div>
            <div className="agent-strip">
              <svg className="agent-river" viewBox="0 0 1200 360" aria-hidden="true" preserveAspectRatio="none">
                <defs><linearGradient id="riverGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#79c8ff"/><stop offset="0.5" stopColor="#5267ff"/><stop offset="1" stopColor="#56d6d0"/></linearGradient></defs>
                <path className="agent-river-glow" d="M32 82 C180 16 338 18 398 92 C455 163 250 174 238 248 C224 334 520 332 704 278 C866 231 1010 261 1168 330" />
                <path className="agent-river-shadow" d="M32 82 C180 16 338 18 398 92 C455 163 250 174 238 248 C224 334 520 332 704 278 C866 231 1010 261 1168 330" />
                <path className="agent-river-core" d="M32 82 C180 16 338 18 398 92 C455 163 250 174 238 248 C224 334 520 332 704 278 C866 231 1010 261 1168 330" />
                {agentLayout.map((layout, index) => (
                  <g key={agents[index].name}>
                    <line className="agent-river-branch" x1={layout.node[0]} y1={layout.node[1]} x2={layout.anchor[0]} y2={layout.anchor[1]} />
                    <circle className="agent-river-node" cx={layout.node[0]} cy={layout.node[1]} r="9" />
                    <foreignObject className="agent-card-object" x={layout.card[0]} y={layout.card[1]} width="196" height="122">
                      <article className="agent-chip">
                        <strong>{agents[index].name}</strong>
                        <span>{agents[index].role}</span>
                        <b>{agents[index].model}</b>
                      </article>
                    </foreignObject>
                  </g>
                ))}
              </svg>
            </div>
          </article>
          <footer className="system-footer panel">
            <img className="system-mark system-logo" src="/LOGO.png" alt="OmniLearn | MAS" />
            <div><strong>OmniLearn | MAS</strong><span>全域学习多智能体系统</span></div>
            <div className="system-meta"><span>课程学习项目</span><span>本地知识库 · Spark 模型 · 可追溯导出</span></div>
            <div className="system-contact"><span>团队：OmniLearn 团队</span><span>联系：本地部署演示 / 项目协作</span></div>
          </footer>
        </section>
        </section>
      </div>

      {isConfigOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="模型配置">
          <section className="config-modal">
            <div className="panel-heading">
              <div>
                <span>Spark Runtime</span>
                <h3>讯飞星火配置</h3>
              </div>
              <button className="text-btn" onClick={() => setConfigOpen(false)}>关闭</button>
            </div>
            <label>APPID<input value={credentials.appId} onChange={(event) => setCredentials({ ...credentials, appId: event.target.value })} /></label>
            <label>APIKey<input value={credentials.apiKey} onChange={(event) => setCredentials({ ...credentials, apiKey: event.target.value })} /></label>
            <label>APISecret<input type="password" value={credentials.apiSecret} onChange={(event) => setCredentials({ ...credentials, apiSecret: event.target.value })} /></label>
            <p>这些信息只提交到本地 Node 服务的运行时内存，不写入源码或索引文件。重启服务后需要重新填写。</p>
            {configTestResult && <p className="config-result">{configTestResult}</p>}
            <div className="modal-actions">
              <button className="secondary-btn" onClick={testSpark} disabled={isBusy || !status?.sparkConfigured}>测试连接</button>
              <button className="primary-btn" onClick={saveCredentials} disabled={isBusy}>保存配置</button>
            </div>
          </section>
        </div>
      )}

      {accountPanel && (
        <div className="account-panel-backdrop" role="presentation" onClick={() => setAccountPanel(null)}>
          <section className={`account-panel ${accountPanel === "settings" ? "settings-panel" : "analytics-panel"}`} role="dialog" aria-modal="true" aria-label={accountPanel === "analytics" ? "工作台数据" : accountPanel === "admin" ? "会员管理" : "账号设置"} onClick={(event) => event.stopPropagation()}>
            <header className="account-panel-head">
              <div><span>{accountPanel === "analytics" ? "Workspace Insights" : accountPanel === "admin" ? "Trial Operations" : "Account & Security"}</span><h2>{accountPanel === "analytics" ? "工作台数据" : accountPanel === "admin" ? "会员管理" : "账号设置"}</h2></div>
              <button type="button" onClick={() => setAccountPanel(null)} aria-label="关闭">×</button>
            </header>
            {accountPanel === "settings" ? (
              <div className="settings-content">
                <section className="account-identity"><span>{currentUser.name.slice(0, 1).toUpperCase()}</span><div><strong>{currentUser.name}</strong><small>{currentUser.email}</small></div></section>
                <section className="settings-section membership-section">
                  <div><h3>会员额度</h3><p>{currentUser.membership.active ? `剩余 ${currentUser.membership.remainingTokens.toLocaleString()} / ${currentUser.membership.quotaTokens.toLocaleString()} Tokens` : "兑换会员码后即可使用服务器上的星火模型，无需填写 API Key。"}</p></div>
                  {!currentUser.membership.active && <><label>会员码<input value={membershipCode} onChange={(event) => setMembershipCode(event.target.value.toUpperCase())} placeholder="SA-XXXX-XXXX-XXXX" /></label><button className="primary-btn" type="button" onClick={redeemMembership}>兑换会员码</button></>}
                  {currentUser.membership.active && <div className="quota-track"><span style={{ width: `${Math.min(100, currentUser.membership.quotaTokens ? currentUser.membership.usedTokens / currentUser.membership.quotaTokens * 100 : 0)}%` }} /></div>}
                </section>
                <section className="settings-section">
                  <div><h3>修改密码</h3><p>更新后会保留当前设备登录，并退出其他设备。</p></div>
                  <label>当前密码<input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></label>
                  <label>新密码<input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} placeholder="至少 8 个字符" /></label>
                  <label>确认新密码<input type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} /></label>
                  <button className="primary-btn" type="button" onClick={changePassword}>保存新密码</button>
                </section>
                <section className="settings-danger"><div><strong>退出当前账号</strong><p>本机登录状态会被清除，项目数据仍安全保留。</p></div><button type="button" onClick={signOut}>退出登录</button></section>
                {accountStatus && <p className="account-panel-status">{accountStatus}</p>}
              </div>
            ) : accountPanel === "analytics" ? (
              <div className="analytics-content">
              <div className="analytics-intro"><div><h3>Hello! {currentUser.name}</h3><p>这是你使用 OmniLearn | MAS 的第 {Math.max(1, Math.ceil((Date.now() - new Date(activitySummary?.joinedAt || Date.now()).getTime()) / 86400000))} 天。</p></div><span>高峰时段 {String(activitySummary?.peakHour || 0).padStart(2, "0")}:00</span></div>
                <section className="activity-overview">
                  <div className="activity-calendar"><div className="analytics-section-head"><strong>最近 12 周活跃记录</strong><span>{activitySummary?.activeDays || 0} 个活跃日</span></div><div className="activity-grid">{activityDays.map((day) => <span key={day.date} title={`${day.date} · ${day.minutes} 分钟`} data-level={day.minutes === 0 ? 0 : day.minutes < 20 ? 1 : day.minutes < 45 ? 2 : day.minutes < 90 ? 3 : 4} />)}</div></div>
                  <div className="analytics-metrics"><article><span>累计使用</span><strong>{Math.floor((activitySummary?.totalMinutes || 0) / 60)}<small>小时</small> {(activitySummary?.totalMinutes || 0) % 60}<small>分钟</small></strong></article><article><span>剩余额度</span><strong>{currentUser.membership.remainingTokens.toLocaleString()}<small>Tokens</small></strong></article><article><span>完成问答</span><strong>{activitySummary?.questionCount || 0}<small>轮</small></strong></article></div>
                </section>
                <section className="focus-chart"><div className="analytics-section-head"><strong>集中使用时间段</strong><span>按登录活跃分钟统计</span></div><svg viewBox="0 0 720 160" role="img" aria-label="24 小时使用时段曲线"><path className="focus-area" d={`${hourCurve} L 720 144 L 0 144 Z`} /><path className="focus-line" d={hourCurve} />{[0, 6, 12, 18, 23].map((hour) => <text key={hour} x={hour * (720 / 23)} y="158" textAnchor={hour === 0 ? "start" : hour === 23 ? "end" : "middle"}>{String(hour).padStart(2, "0")}:00</text>)}</svg></section>
                {accountStatus && <p className="account-panel-status">{accountStatus}</p>}
              </div>
            ) : (
              <div className="analytics-content admin-content">
                <section className="admin-code-builder"><div><h3>批量生成会员码</h3><p>每个码仅能绑定一个账号，额度由服务器统一扣减。</p></div><label>数量<input type="number" min="1" max="200" value={codeBatchCount} onChange={(event) => setCodeBatchCount(Number(event.target.value))} /></label><label>每码额度<input type="number" min="1000" step="100000" value={codeQuota} onChange={(event) => setCodeQuota(Number(event.target.value))} /></label><button className="primary-btn" type="button" onClick={createCodeBatch}>生成并复制</button></section>
                <section className="admin-table-wrap"><div className="analytics-section-head"><strong>试用账号</strong><span>{adminUsers.length} 人</span></div><table><thead><tr><th>账号</th><th>会员</th><th>已用 / 总额</th><th>总时长</th></tr></thead><tbody>{adminUsers.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.membership.active ? "已激活" : "未兑换"}</td><td>{user.membership.usedTokens.toLocaleString()} / {user.membership.quotaTokens.toLocaleString()}</td><td>{Math.floor(user.totalMinutes / 60)}h {user.totalMinutes % 60}m</td></tr>)}</tbody></table></section>
                <section className="admin-code-list"><div className="analytics-section-head"><strong>最近会员码</strong><span>{adminCodes.length} 个</span></div><div>{adminCodes.slice(0, 100).map((item) => <button type="button" key={item.id} onClick={async () => setAccountStatus(await copyText(item.code) ? `已复制 ${item.code}` : `复制受限，请手动选择 ${item.code}`)}><code>{item.code}</code><span>{item.status === "available" ? "待兑换" : item.status === "redeemed" ? "已兑换" : "已停用"}</span></button>)}</div></section>
                {accountStatus && <p className="account-panel-status">{accountStatus}</p>}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
