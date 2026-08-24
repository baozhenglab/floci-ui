# CLAUDE.md — floci-ui

Context file cho Claude Code khi làm việc trên repo này. Tổng hợp từ audit v0.3.0 (51 subagent, 479 test / 0 fail phía API) + roadmap tính năng đề xuất.

---

## 1. Repo là gì

Floci UI — web console kiểu AWS Console cho [Floci](https://github.com/floci-io/floci), local cloud emulator. AWS-only kể từ đợt narrowing (Azure/GCP đã bị xoá; git history giữ lại). pnpm monorepo ~25k dòng TS/TSX:

| Package | Stack | Port |
|---|---|---|
| `packages/frontend` | React 19 + Vite 8 | 4500 |
| `packages/api` | Bun + Hono 4 + AWS SDK v3 | 4501 |

Runtime đích: Floci core (4566).

Trạng thái coverage: AWS 9/10 service available (chỉ `iac`/CloudFormation là coming_soon). 10 service trong catalog, 8 adapter đã register.

## 2. Bất biến kiến trúc — KHÔNG được phá

Đây là những nguyên tắc đã được enforce bằng test/máy, mọi thay đổi phải giữ nguyên:

1. **UI không biết cloud.** Frontend render mọi service từ `ServiceSchema` do backend cấp qua `GET /api/clouds/:cloud/services`. Không hardcode provider logic vào frontend.
2. **Thêm service = 1 catalog row + 1 adapter, zero frontend edit.** Catalog ở `packages/api/src/cloud-spi/serviceCatalog.ts`. Nếu một PR thêm service mà phải sửa frontend → thiết kế sai, dừng lại.
3. **Availability được derive từ registry, không declare tay.** `cloudProxy.test.ts` enforce rằng không schema nào advertise capability mà adapter không implement. Mọi capability mới phải pass test này.
4. **Capability honesty.** Service unavailable phải mang `reason` cụ thể (`operation_not_implemented` / `runtime_unavailable` / `operation_not_supported`). Không bao giờ render nút rồi trả 501. Không fake data, không demo rows.
5. **Route guard dùng `Object.hasOwn`** (đã có test chống `__proto__` pollution) — giữ pattern này cho mọi lookup dynamic key mới.
6. **README service matrix là generated.** Sau khi sửa catalog hoặc adapter registry, chạy:
   ```bash
   cd packages/api && bun run scripts/service-matrix.ts
   ```
   Không sửa bảng bằng tay.

## 3. Nợ kỹ thuật đã xác nhận — sửa trước khi thêm tính năng

### P0 — Security & ổn định

| # | Vấn đề | Chi tiết | Hướng sửa |
|---|---|---|---|
| 1 | **Không authentication + CORS wildcard** | API server giữ AWS credentials, expose endpoint destructive (delete/terminate) trên generic contract, CORS `*` | Thêm session token đơn giản (env `FLOCI_UI_TOKEN` hoặc auto-generate lúc boot, in ra console như Jupyter); CORS allowlist mặc định `localhost:4500`; middleware Hono gate mọi route mutating |
| 2 | **Không có ErrorBoundary** | Một render throw → blank cả app | ErrorBoundary per-route + fallback UI có nút "report" kèm stack; wrap Cloud Explorer riêng để một service lỗi không giết cả console |
| 3 | **Frontend 15.025 dòng, zero test, không có runner** | Lint `continue-on-error` nên CI không gate gì | Cài Vitest + React Testing Library; bỏ `continue-on-error`; test đầu tiên nhắm vào capability-driven rendering (schema → UI đúng nút, disabled đúng reason) vì đây là contract cốt lõi |

### P1 — Hygiene

| # | Vấn đề | Hướng sửa |
|---|---|---|
| 4 | **Tailwind có trong `package.json` nhưng không wire** — không config, zero `@tailwind` directive; `lib/utils.ts:33-36` emit `text-green-400` resolve thành không gì | Quyết định 1 trong 2: wire Tailwind thật (config + directive + shadcn/ui) hoặc gỡ dependency và viết lại util bằng CSS hiện có. Không để trạng thái lửng |
| 5 | **Doc drift phần prose** — 5 chỗ prose mâu thuẫn với bảng generated; `AGENTS.md` trỏ vào directory dead 1.778 dòng | Sửa 5 chỗ prose; xóa/redirect `AGENTS.md`; thêm CI step diff bảng generated vs bảng trong README để bắt drift tự động |

## 4. Roadmap tính năng mới — đề xuất

Sắp theo tỷ lệ giá trị/công sức, tận dụng tối đa kiến trúc SPI hiện có.

### Tier 1 — Hoàn thiện contract hiện có (công sức thấp, kiến trúc đã sẵn)

**F1. Migrate DynamoDB + Secrets Manager vào Cloud Explorer.**
Hai legacy page cuối cùng nằm ngoài unified model. DynamoDB cần item browser + PartiQL query editor (tái dùng pattern SQL editor đã có của Cosmos DB). Secrets Manager đã đủ CRUD, chỉ cần chuyển sang SPI contract. Xong việc này thì "old page" = 0, codebase một model duy nhất.

**F2. Messaging category: SQS + SNS.**
Floci core đã emulate SQS/SNS nhưng UI chưa expose. Đúng công thức "1 catalog row + 1 adapter": list queue/topic, send message, poll/receive, xem message body + attributes, purge queue. Đây là service dev dùng hằng ngày khi test event-driven flow — giá trị cao nhất trong các service còn thiếu.

**F3. Bulk multi-select trong Storage.**
Gap đã ghi trong README. Checkbox trên resource table + bulk delete/download. Kéo theo: thêm khái niệm `bulkActions` vào `ServiceSchema` để mọi service tương lai hưởng lợi, không chỉ storage.

**F4. ~~Azure VNet + GCP VPC adapter cho Networking~~ — không còn áp dụng.**
Đã bỏ khi repo chuyển sang AWS-only. Thay thế đề xuất: hoàn thiện Networking AWS
(create/delete qua generic contract thay vì `partial` + panel riêng).

### Tier 2 — Tính năng khác biệt hóa (thứ AWS Console thật không có)

**F5. Emulator State Snapshots (seed/save/restore).**
Floci core hỗ trợ storage mode `memory`/`persistent`/`wal`. UI thêm trang "Scenarios": chụp toàn bộ state emulator thành named snapshot, restore 1 click, export/import file để share trong team. Use case: dev A dựng sẵn VPC + 3 bucket + 2 Lambda cho integration test, dev B import là chạy được ngay. Đây là killer feature cho local emulator mà console cloud thật không thể có.

**F6. IaC Plan Visualizer.**
Panel chạy `terraform plan` / CDK synth trỏ vào Floci endpoint, parse plan JSON, render diff dạng resource graph (tạo/sửa/xóa màu riêng). Lấp luôn ô CloudFormation đang No/No/No trong matrix bằng cách tiếp cận thực dụng hơn: thay vì emulate CFN engine, visualize cái plan mà tool thật sinh ra.

**F7. Resource Relationship Graph.**
Data đã có sẵn qua adapter (VPC → subnet → SG → EC2 instance; Lambda → API Gateway route). Render graph tương tác (click node → mở inspector tương ứng). Bắt đầu AWS-only với Networking + Compute vì adapter giàu nhất.

**F8. Action Audit Log.**
Mọi mutating call qua proxy được append vào log (in-memory ring buffer + optional persist): timestamp, cloud, service, action, payload tóm tắt, kết quả. Trang "Activity" hiển thị. Vừa là debugging aid, vừa là nền cho F5 (replay log = rebuild state).

### Tier 3 — Meta & DX

**F9. Capability Coverage page trong chính UI.**
Render service matrix (đang chỉ có trong README) thành trang live trong console, đọc trực tiếp từ registry. Mỗi ô No hiển thị đúng `reason` từ server. Doc drift phần này = 0 vĩnh viễn vì không còn bảng tĩnh nào để drift.

**F10. Adapter Conformance Test Generator.**
Mở rộng ý tưởng của `cloudProxy.test.ts`: script đọc `ServiceSchema` → sinh contract test skeleton cho adapter mới (list trả đúng shape, create → xuất hiện trong list, delete → biến mất, unavailable → đúng errorCode). Contributor viết adapter chỉ cần làm test pass. Giảm mạnh chi phí review cho adapter cộng đồng.

**F11. Lambda DX pack.**
Invoke đã có tailed log; thêm: thư viện test event templates (S3 put, SQS message, API GW proxy...), env var editor, và nâng tailed log từ polling lên WebSocket live tail. Serverless là service dev tương tác nhiều nhất — DX ở đây đáng đầu tư disproportionately.

**F12. Multi-account / multi-region switcher.**
Floci hỗ trợ `FLOCI_DEFAULT_ACCOUNT_ID` và mọi region. UI thêm switcher ở header, truyền account/region qua proxy. Cho phép test cross-account scenario (bucket policy, assume role mô phỏng) — thứ rất khó test với cloud thật.

## 5. Thứ tự thực thi đề xuất

```
Sprint 1: P0 #1 (auth+CORS) → P0 #2 (ErrorBoundary) → P0 #3 (Vitest skeleton + 10 test đầu)
Sprint 2: P1 #4 (Tailwind quyết) → P1 #5 (doc drift) → F1 (unify legacy pages)
Sprint 3: F2 (SQS/SNS) → F3 (bulk actions) → F9 (coverage page, nhỏ)
Sprint 4: F5 (snapshots — khác biệt hóa chính) → F8 (audit log, chung hạ tầng với F5)
Sau đó:  F6/F7/F10/F11/F12 theo nhu cầu
```

Lý do auth đứng đầu: mọi tính năng mới (đặc biệt F5 snapshot restore, F8 audit) đều tăng blast radius của một server không auth đang giữ credential.

## 6. Convention khi code trong repo này

- **Toolchain:** Node 20+, pnpm 9+, Bun (API chạy từ `packages/api`, load env từ `packages/api/.env`).
- **Verify trước khi commit:** `pnpm lint && pnpm type-check && pnpm test && pnpm build`. Lưu ý eslint có thể abort `ConfigError: structuredClone is not defined` trên Node cũ — cần Node 20+.
- **Thêm service:** catalog row trong `serviceCatalog.ts` + adapter trong `adapter-{aws,azure,gcp}/`. Regenerate service matrix. Không sửa frontend.
- **Thêm capability cho adapter:** implement trước, advertise sau — `cloudProxy.test.ts` sẽ fail nếu làm ngược.
- **Placeholder rõ ràng thay vì fake data.** Capability chưa xong → `coming_soon` + reason, không render UI giả.
- **Update README khi UI surface đổi** — nhưng chỉ phần prose; bảng luôn generate bằng script.
- **Panel provider-specific chỉ khi generic form không đủ** (tiền lệ: EC2 launch, VPC wizard cần dependent selectors). Mặc định luôn thử unified shell trước.