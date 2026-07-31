import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("모든 button은 클릭 처리 또는 명시적 submit 동작을 가진다", () => {
  const fileName = new URL("../app/page.tsx", import.meta.url).pathname;
  const source = readFileSync(fileName, "utf8");
  const tree = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const missing = [];

  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === "button") {
      const attributes = node.attributes.properties;
      const hasClick = attributes.some(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === "onClick",
      );
      const hasSubmit = attributes.some((attribute) => {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(tree) !== "type") return false;
        return attribute.initializer?.getText(tree).replaceAll('"', "") === "submit";
      });
      const isDisabled = attributes.some(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === "disabled",
      );
      if (!hasClick && !hasSubmit && !isDisabled) {
        const position = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        missing.push(`line ${position.line + 1}: ${node.getText(tree).slice(0, 100)}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(tree);
  assert.deepEqual(missing, [], `동작 없는 버튼:\n${missing.join("\n")}`);
});

test("전략 블록의 긴 문구는 모바일에서도 고정 높이에 갇히지 않는다", () => {
  const fileName = new URL("../app/globals.css", import.meta.url).pathname;
  const source = readFileSync(fileName, "utf8");

  assert.match(source, /\.logic-block\{height:auto;min-height:54px;/);
  assert.match(source, /\.logic-block-label\{[^}]*height:auto!important;[^}]*white-space:normal!important;/);
  assert.match(source, /\.logic-block>button:last-child\{[^}]*flex:0 0 30px;/);
});

test("중간 폭 전략 제어에서 성과 정보와 버튼은 같은 그리드 행을 공유하지 않는다", () => {
  const fileName = new URL("../app/globals.css", import.meta.url).pathname;
  const source = readFileSync(fileName, "utf8");

  assert.match(source, /\.strategy-control dl\{grid-column:2;grid-row:1\/4;/);
  assert.match(source, /\.strategy-control-actions\{grid-column:1\/3;grid-row:4;/);
  assert.doesNotMatch(source, /\.strategy-control dl,\.strategy-control-actions\{grid-column:2;grid-row:1\/4;/);
});

test("다크 모드의 버튼과 비활성 상태는 전용 배경·글자 대비를 가진다", () => {
  const fileName = new URL("../app/institutional.css", import.meta.url).pathname;
  const source = readFileSync(fileName, "utf8");

  assert.match(source, /\.product\.dark\s+\.btn\.secondary\{[^}]*background:var\(--control-bg\);[^}]*color:var\(--control-text\);/);
  assert.match(source, /\.product\.dark\s+\.btn:disabled\{[^}]*background:var\(--disabled-bg\)!important;[^}]*color:var\(--disabled-text\)!important;[^}]*opacity:1;/);
  assert.match(source, /\.product\.dark\s+\.security-tip button:disabled\{[^}]*color:var\(--disabled-text\);[^}]*opacity:1;/);
});

test("다크 모드의 입력 요소와 AI 응답 카드가 어두운 표면을 사용한다", () => {
  const fileName = new URL("../app/institutional.css", import.meta.url).pathname;
  const source = readFileSync(fileName, "utf8");

  assert.match(source, /\.product\.dark input:not\(\[type="range"\]\)[^{]*,[\s\S]*?\.product\.dark textarea\{[^}]*background:#111317;[^}]*color:var\(--control-text\);/);
  assert.match(source, /\.product\.dark\s+\.copilot-messages \.assistant\{[^}]*background:var\(--surface-2\);[^}]*color:var\(--text\);/);
  assert.match(source, /\.product\.dark\s+\.institutional-status-strip,[\s\S]*?\.product\.dark\s+\.copilot-safety-strip\{[^}]*background:var\(--surface\);[^}]*color:var\(--muted\);/);
});

test("설정 카드는 두 독립 열에서 내용 높이만 사용한다", () => {
  const pageFile = new URL("../app/page.tsx", import.meta.url).pathname;
  const styleFile = new URL("../app/institutional.css", import.meta.url).pathname;
  const pageSource = readFileSync(pageFile, "utf8");
  const styleSource = readFileSync(styleFile, "utf8");

  assert.equal(pageSource.match(/className="settings-column"/g)?.length, 2);
  assert.match(styleSource, /\.settings-page \.settings-column\{[^}]*align-content:start;[^}]*gap:10px;/);
  assert.match(styleSource, /\.settings-page \.settings-column>\.panel\{[^}]*min-height:0;[^}]*padding:15px;/);
  assert.match(styleSource, /@media\(max-width:900px\)\{[\s\S]*?\.settings-page \.settings-grid\{[^}]*grid-template-columns:1fr;/);
});

test("리스크 통제센터는 핵심 상태 6칸과 내용 높이 기반 2열을 사용한다", () => {
  const pageFile = new URL("../app/page.tsx", import.meta.url).pathname;
  const styleFile = new URL("../app/institutional.css", import.meta.url).pathname;
  const pageSource = readFileSync(pageFile, "utf8");
  const styleSource = readFileSync(styleFile, "utf8");

  assert.match(pageSource, /const controlSummary = \[[\s\S]*?label: "런타임 경고"/);
  assert.match(pageSource, /className="control-summary-grid" aria-label="리스크 통제 핵심 상태"/);
  assert.match(pageSource, /onClick=\{\(\) => go\("settings"\)\}>정책 관리<\/button>/);
  assert.match(pageSource, /onClick=\{\(\) => go\("operations"\)\}>긴급 통제 열기<\/button>/);
  assert.match(styleSource, /\.control-summary-grid\{[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\);/);
  assert.match(styleSource, /\.institutional-control-page \.control-grid\{[^}]*align-items:start;/);
  assert.match(styleSource, /@media\(max-width:1180px\) and \(min-width:901px\)\{[\s\S]*?\.institutional-control-page \.control-grid\{[^}]*grid-template-columns:minmax\(0,1\.55fr\) minmax\(280px,\.72fr\);/);
});

test("검증되지 않은 백테스트는 모의 운영 전환을 코드 수준에서 차단한다", () => {
  const pageFile = new URL("../app/page.tsx", import.meta.url).pathname;
  const source = readFileSync(pageFile, "utf8");
  const backtest = source.slice(source.indexOf("function Backtest"), source.indexOf("function ExecutionReview"));

  assert.match(backtest, /검증 완료 후 모의 운영 가능<\/button>/);
  assert.match(backtest, /className="btn primary validation-locked" disabled/);
  assert.doesNotMatch(backtest, /go\("execution"\)/);
  assert.match(backtest, /전략 버전·콘텐츠 해시/);
  assert.match(backtest, /표본 외·워크포워드 검증/);
});

test("기관 핵심 화면은 PAPER 출처와 객체 단위 모의 표식을 노출한다", () => {
  const pageFile = new URL("../app/page.tsx", import.meta.url).pathname;
  const source = readFileSync(pageFile, "utf8");

  assert.match(source, /className="data-provenance-strip" aria-label="모의 데이터 출처"/);
  assert.match(source, /PAPER · 의사결정 금지/);
  assert.match(source, /title="모의 운영센터"/);
  assert.match(source, /선택 모의 주문 <em className="paper-object-badge">PAPER<\/em>/);
  assert.match(source, /강한 재인증 \+ 독립 승인자/);
});

test("운영·포지션 표는 모바일 카드와 내용 높이 기반 보조 패널을 사용한다", () => {
  const styleFile = new URL("../app/institutional.css", import.meta.url).pathname;
  const source = readFileSync(styleFile, "utf8");

  assert.match(source, /\.operations-grid\{\s*align-items:start;/);
  assert.match(source, /\.order-focus\{\s*align-self:start;/);
  assert.match(source, /@media\(max-width:720px\)\{[\s\S]*?\.live-order-table td:before,[\s\S]*?content:attr\(data-label\);/);
  assert.match(source, /@media\(max-width:720px\)\{[\s\S]*?\.institutional-positions td:before\{/);
});

test("PC 기관 콘솔은 탐색·본문·표에 읽을 수 있는 최소 글자 크기를 보장한다", () => {
  const styleFile = new URL("../app/institutional.css", import.meta.url).pathname;
  const source = readFileSync(styleFile, "utf8");
  const baseline = source.slice(source.indexOf("Desktop console readability baseline"));

  assert.match(baseline, /\.institutional-header nav button\{\s*font-size:12px;/);
  assert.match(baseline, /\.institutional-sidebar button\{[\s\S]*?font-size:13px;/);
  assert.match(baseline, /\.product-page :where\(p,small,dt,dd\)\{\s*font-size:12px!important;/);
  assert.match(baseline, /\.product-page :where\(th\)\{\s*font-size:11px!important;/);
  assert.match(baseline, /\.product-page :where\(td\)\{\s*font-size:12px!important;/);
  assert.match(baseline, /\.product\.dark\{[\s\S]*?--muted:#aeb9c9;/);
});
