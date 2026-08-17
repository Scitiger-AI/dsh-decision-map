// dsh-decision-map — browser half.
//
// Hand-written client bundle (the same `window.__ModuleLoader__.load` shape the
// shipped client packages emit; no tsdown/TypeScript required). The factory
// requires only `react` (a platform seed the web shell registers) and declares
// one runtime service, `slots`.
//
// `apply(ctx)` registers the "决策地图" tab into the conversation view ring
// (`conversation.view`, a `list` slot). The view reads the node half's computed
// value through `useProjection("decisionMap")` and renders a dashboard stat band
// plus a two-column timeline: the left column is a vertical timeline where every
// agent action is its own card (emoji node icon 思考 💭 / 工具 🔧 / 写文件 ✍️ on
// a colored spine); clicking a card opens its details in the right-side panel.
//
// Pure inline styles + plain `div`. Node colors come from the shell's static
// color system (`--dsw-static-amber/blue/green-500`); other surfaces adapt via
// the shell's theme aliases (`--dsw-alias-*`). No external library, CDN, font,
// or image (emoji are the platform's system glyphs).

window.__ModuleLoader__.load({
  id: "dsh-decision-map",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");

    var inject = ["slots"];

    // ── palette ──────────────────────────────────────────────────────────────

    var NODE = {
      think: { label: "思考", color: "var(--dsw-static-amber-500)", emoji: "💭" },
      tool: { label: "工具", color: "var(--dsw-static-blue-500)", emoji: "🔧" },
      write: { label: "写文件", color: "var(--dsw-static-green-500)", emoji: "✍️" },
    };

    // Theme aliases → light/dark adaptive chrome.
    var C = {
      text: "var(--dsw-alias-label-primary)",
      text2: "var(--dsw-alias-label-secondary)",
      surface: "var(--dsw-alias-bg-layer-1)",
      surface2: "var(--dsw-alias-bg-layer-2)",
      border: "var(--dsw-alias-border-l2)",
    };

    // ── helpers ──────────────────────────────────────────────────────────────

    function tint(color) {
      return "color-mix(in srgb, " + color + " 18%, transparent)";
    }

    function fmtDuration(ms) {
      if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
      if (ms < 1000) return Math.round(ms) + "ms";
      if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
      var m = Math.floor(ms / 60000);
      var s = Math.round((ms % 60000) / 1000);
      if (s === 60) { m += 1; s = 0; }
      return s === 0 ? m + "m" : m + "m " + s + "s";
    }

    function fmtTokens(n) {
      var v = Number.isFinite(n) ? n : 0;
      if (v >= 1000000) return (v / 1000000).toFixed(1) + "M";
      if (v >= 1000) return (v / 1000).toFixed(1) + "k";
      return String(v);
    }

    function fmtElapsed(ms) {
      if (ms < 1000) return "0s";
      if (ms < 60000) return Math.round(ms / 1000) + "s";
      var m = Math.floor(ms / 60000);
      var s = Math.round((ms % 60000) / 1000);
      if (s === 60) { m += 1; s = 0; }
      return s === 0 ? m + "m" : m + "m " + s + "s";
    }

    function fmtClock(ms) {
      if (!Number.isFinite(ms)) return "";
      var d = new Date(ms);
      function p(n) { return (n < 10 ? "0" : "") + n; }
      return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    }

    function groupByTurn(nodes) {
      var turns = [];
      var byTurn = {};
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (byTurn[n.turn] === undefined) {
          byTurn[n.turn] = { turn: n.turn, nodes: [] };
          turns.push(byTurn[n.turn]);
        }
        byTurn[n.turn].nodes.push(n);
      }
      return turns;
    }

    function turnSpan(nodes) {
      var start = Infinity;
      var end = -Infinity;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.time < start) start = n.time;
        var e = n.time + (typeof n.durationMs === "number" ? n.durationMs : 0);
        if (e > end) end = e;
      }
      return Number.isFinite(start) && end >= start ? end - start : 0;
    }

    function findNode(nodes, seq) {
      if (seq === null || seq === undefined) return null;
      for (var i = 0; i < nodes.length; i++) if (nodes[i].seq === seq) return nodes[i];
      return null;
    }

    function previewText(text, n) {
      if (typeof text !== "string") return "";
      if (text.length <= n) return text;
      return text.slice(0, n).trimEnd() + "…";
    }

    // ── styles ───────────────────────────────────────────────────────────────

    var S = {
      wrap: { padding: "24px 24px 64px", fontFamily: "inherit", lineHeight: 1.5, width: "100%" },

      header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "0 0 4px" },
      title: { fontSize: 20, fontWeight: 800, color: C.text, margin: 0, letterSpacing: "-0.01em" },
      legend: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
      chip: { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, border: "1px solid " + C.border, background: C.surface, fontSize: 12, fontWeight: 600, color: C.text },

      subtitle: { fontSize: 12, color: C.text2, margin: "0 0 18px" },

      cards: { display: "flex", flexWrap: "wrap", gap: 12, margin: "0 0 24px" },
      card: { flex: "1 1 150px", minWidth: 140, padding: "13px 15px 12px", borderRadius: 14, border: "1px solid " + C.border, background: C.surface },
      cardTop: { display: "flex", alignItems: "center", gap: 7, margin: "0 0 9px" },
      cardDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
      cardLabel: { fontSize: 11, fontWeight: 600, color: C.text2 },
      cardValue: { fontSize: 24, fontWeight: 800, color: C.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" },
      cardHint: { fontSize: 11, color: C.text2, margin: "8px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },

      body: { display: "flex", gap: 18, alignItems: "flex-start" },
      timeline: { flex: 1, minWidth: 0 },

      sectionHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "0 0 4px" },
      sectionTitle: { fontSize: 13, fontWeight: 700, color: C.text, margin: 0 },
      sectionMeta: { fontSize: 11, color: C.text2, margin: 0 },

      turnHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, margin: "22px 0 14px" },
      turnTitle: { fontSize: 15, fontWeight: 800, color: C.text },
      turnMeta: { fontSize: 11, color: C.text2, fontVariantNumeric: "tabular-nums" },

      actionRow: { display: "flex", gap: 12, margin: "0 0 12px" },
      rail: { display: "flex", flexDirection: "column", alignItems: "center", width: 40, flexShrink: 0 },
      iconChip: { width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, lineHeight: 1, flexShrink: 0 },
      spine: { width: 2, flex: 1, minHeight: 16, marginTop: 3, background: "rgba(128,128,128,0.22)" },

      actionCard: { flex: 1, minWidth: 0, padding: "14px 16px", borderRadius: 12, border: "1px solid " + C.border, background: C.surface, cursor: "pointer" },
      actionTop: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
      typeTag: { fontSize: 15, fontWeight: 800 },
      actionLabel: { fontSize: 15, fontWeight: 700, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: C.text },
      actionMeta: { marginLeft: "auto", fontSize: 11, color: C.text2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
      actionDetail: { fontSize: 13, color: C.text2, margin: "7px 0 0", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" },

      detailPanel: { width: 380, flexShrink: 0, position: "sticky", top: 12, padding: "18px", borderRadius: 14, border: "1px solid " + C.border, background: C.surface },
      detailEmpty: { fontSize: 12.5, color: C.text2, textAlign: "center", padding: "30px 8px", lineHeight: 1.6 },
      detailHead: { display: "flex", alignItems: "center", gap: 12, margin: "0 0 16px" },
      detailTitleWrap: { flex: 1, minWidth: 0 },
      detailTitle: { fontSize: 15, fontWeight: 800, color: C.text, wordBreak: "break-word" },
      detailMeta: { fontSize: 11, color: C.text2, margin: "3px 0 0" },
      infoRow: { display: "flex", justifyContent: "space-between", gap: 12, margin: "8px 0 0" },
      infoKey: { fontSize: 12, color: C.text2, flexShrink: 0 },
      infoVal: { fontSize: 12, fontWeight: 600, color: C.text, textAlign: "right", wordBreak: "break-word" },
      detailBlock: { margin: "14px 0 0", padding: "12px", borderRadius: 10, background: C.surface2, fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere", maxHeight: 480, overflow: "auto" },
      detailBlockTitle: { fontSize: 11, fontWeight: 700, color: C.text2, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.03em" },

      timelineEmpty: { padding: "26px 12px", textAlign: "center", border: "1px dashed " + C.border, borderRadius: 10, color: C.text2, fontSize: 12 },

      empty: { padding: "48px 20px", textAlign: "center" },
      emptyTitle: { fontSize: 17, fontWeight: 800, color: C.text, margin: "0 0 8px" },
      emptyText: { fontSize: 13, color: C.text2, margin: 0 },
    };

    // ── presentational components ────────────────────────────────────────────

    function StatCard(props) {
      return React.createElement("div", { style: S.card },
        React.createElement("div", { style: S.cardTop },
          React.createElement("span", { style: Object.assign({}, S.cardDot, { background: props.accent }) }),
          React.createElement("span", { style: S.cardLabel }, props.label)
        ),
        React.createElement("div", { style: S.cardValue }, props.value),
        React.createElement("div", { style: S.cardHint, title: props.hint }, props.hint)
      );
    }

    function Legend() {
      var chips = ["think", "tool", "write"].map(function (k) {
        var meta = NODE[k];
        return React.createElement("span", { key: k, style: S.chip }, meta.emoji + " " + meta.label);
      });
      return React.createElement("div", { style: S.legend }, chips);
    }

    function InfoRow(props) {
      return React.createElement("div", { style: S.infoRow },
        React.createElement("span", { style: S.infoKey }, props.k),
        React.createElement("span", { style: S.infoVal }, props.v)
      );
    }

    function ActionRow(props) {
      var node = props.node;
      var meta = NODE[node.type] || NODE.tool;
      var dur = fmtDuration(node.durationMs);
      var cardStyle = props.isSelected
        ? Object.assign({}, S.actionCard, { borderColor: meta.color, boxShadow: "0 0 0 1px " + meta.color })
        : S.actionCard;
      return React.createElement("div", { style: S.actionRow },
        React.createElement("div", { style: S.rail },
          React.createElement("span", { style: Object.assign({}, S.iconChip, { background: tint(meta.color) }) }, meta.emoji),
          props.isLast ? null : React.createElement("span", { style: S.spine })
        ),
        React.createElement("div", {
          style: cardStyle,
          role: "button",
          tabIndex: 0,
          onClick: function () { props.onSelect(node.seq); },
          onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") props.onSelect(node.seq); },
        },
          React.createElement("div", { style: S.actionTop },
            React.createElement("span", { style: Object.assign({}, S.typeTag, { color: meta.color }) }, meta.label),
            node.type === "think" ? null : React.createElement("span", { style: S.actionLabel }, node.label),
            React.createElement("span", { style: S.actionMeta },
              (dur || "进行中") + " · 第 " + node.turn + " 轮 · 第 " + node.step + " 步"
            )
          ),
          node.detail
            ? React.createElement("div", {
                style: Object.assign({}, S.actionDetail, node.type === "think" ? null : { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }),
              }, previewText(node.detail, 200))
            : null
        )
      );
    }

    function TurnSection(props) {
      var nodes = props.nodes;
      var span = turnSpan(nodes);
      var actions = nodes.map(function (n, i) {
        return React.createElement(ActionRow, {
          key: n.seq, node: n, isLast: i === nodes.length - 1,
          isSelected: n.seq === props.selectedSeq,
          onSelect: props.onSelect,
        });
      });
      return React.createElement(React.Fragment, null,
        React.createElement("div", { style: S.turnHead },
          React.createElement("div", { style: S.turnTitle }, "第 " + props.turn + " 轮"),
          React.createElement("div", { style: S.turnMeta }, nodes.length + " 个动作" + (span ? " · 跨度 " + fmtElapsed(span) : ""))
        ),
        actions
      );
    }

    function DetailPanel(props) {
      var node = props.node;
      if (node === null || node === undefined) {
        return React.createElement("div", { style: S.detailPanel },
          React.createElement("div", { style: S.detailEmpty }, "👆 点击左侧任一动作，查看它的详情。")
        );
      }
      var meta = NODE[node.type] || NODE.tool;
      var dur = fmtDuration(node.durationMs);
      var blockStyle = node.type === "think"
        ? S.detailBlock
        : Object.assign({}, S.detailBlock, { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" });
      return React.createElement("div", { style: S.detailPanel },
        React.createElement("div", { style: S.detailHead },
          React.createElement("span", { style: Object.assign({}, S.iconChip, { background: tint(meta.color) }) }, meta.emoji),
          React.createElement("div", { style: S.detailTitleWrap },
            React.createElement("div", { style: S.detailTitle }, node.type === "think" ? meta.label : meta.label + " · " + node.label),
            React.createElement("div", { style: S.detailMeta }, "第 " + node.turn + " 轮 · 第 " + node.step + " 步")
          )
        ),
        React.createElement(InfoRow, { k: "类型", v: meta.label }),
        React.createElement(InfoRow, { k: "耗时", v: dur || "进行中" }),
        React.createElement(InfoRow, { k: "时间", v: fmtClock(node.time) }),
        node.detail
          ? React.createElement("div", { style: { margin: "14px 0 0" } },
              React.createElement("div", { style: S.detailBlockTitle }, node.type === "think" ? "推理" : "参数 / 详情"),
              React.createElement("div", { style: blockStyle }, node.detail)
            )
          : null
      );
    }

    // ── the view ─────────────────────────────────────────────────────────────

    function DecisionMapView(props) {
      var data = props.useProjection("decisionMap");
      if (data === undefined || data === null) {
        return React.createElement("div", { style: S.empty },
          React.createElement("div", { style: S.emptyTitle }, "决策地图"),
          React.createElement("p", { style: S.emptyText }, "暂无执行轨迹——开始一个任务后，这里会画出 Agent 每一步的决策地图。")
        );
      }

      var stats = data.stats || {};
      var nodes = data.timeline || [];
      var turns = groupByTurn(nodes);
      var most = stats.mostExpensive || {};

      var sel = React.useState(null);
      var selectedSeq = sel[0];
      var setSelectedSeq = sel[1];
      var selected = findNode(nodes, selectedSeq);

      var mostValue = most.durationMs > 0 ? fmtDuration(most.durationMs) : "—";
      var mostHint = most.durationMs > 0
        ? ("第 " + most.turn + " 轮 · 第 " + most.step + " 步" + (most.label ? " · " + most.label : ""))
        : "暂无";

      var timelineBody;
      if (nodes.length === 0) {
        timelineBody = React.createElement("div", { style: S.timelineEmpty }, "还没有任何动作。");
      } else {
        timelineBody = turns.map(function (lane) {
          return React.createElement(TurnSection, {
            key: lane.turn, turn: lane.turn, nodes: lane.nodes,
            selectedSeq: selectedSeq, onSelect: setSelectedSeq,
          });
        });
      }

      return React.createElement("div", { style: S.wrap },
        React.createElement("div", { style: S.header },
          React.createElement("h2", { style: S.title }, "决策地图"),
          React.createElement(Legend)
        ),
        React.createElement("div", { style: S.subtitle }, "执行轨迹 · 从用户开口到任务完成，点击任一动作查看详情"),

        React.createElement("div", { style: S.cards },
          React.createElement(StatCard, { accent: "var(--dsw-static-blue-500)", label: "总 Token", value: fmtTokens(stats.totalTokens), hint: "输入 " + fmtTokens(stats.inputTokens) + " · 输出 " + fmtTokens(stats.outputTokens) }),
          React.createElement(StatCard, { accent: "var(--dsw-static-amber-500)", label: "工具调用", value: String(stats.toolCalls ?? 0), hint: "共 " + (stats.steps ?? 0) + " 步" }),
          React.createElement(StatCard, { accent: "var(--dsw-static-green-500)", label: "轮次", value: String(stats.turns ?? 0), hint: "用户开口次数" }),
          React.createElement(StatCard, { accent: "var(--dsw-static-red-500)", label: "最耗时步骤", value: mostValue, hint: mostHint })
        ),

        React.createElement("div", { style: S.body },
          React.createElement("div", { style: S.timeline },
            React.createElement("div", { style: S.sectionHead },
              React.createElement("div", { style: S.sectionTitle }, "时间线"),
              React.createElement("div", { style: S.sectionMeta }, "共 " + nodes.length + " 个动作 · " + turns.length + " 轮")
            ),
            timelineBody
          ),
          React.createElement(DetailPanel, { node: selected })
        )
      );
    }

    function apply(ctx) {
      ctx.slots.inject("conversation.view", () => ctx.slots.register({
        name: "conversation.view",
        id: "decision-map",
        order: 20,
        label: "决策地图",
      }, DecisionMapView));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
