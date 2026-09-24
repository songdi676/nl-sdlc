---
name: delivery
description: Use when preparing a merge after code review passed - running final quality gates and tests, opening or updating the merge request, and documenting the human approval requirement
---

# 交付

## Overview

交付 = 最终质量门 + 测试全绿 + MR 人工批准。交付环节 AI 不代替人做合并决定：MR 必须由人工批准后才可合并。CI 的硬关卡是质量门与测试；本 skill 负责交互式会话内的交付准备。

铁律：AI 做交付准备，人做合并决定。质量门、测试、评审 Critical 清零、变更清单四项缺一不可，缺哪项就补齐哪项，不带着窟窿进 MR。

## 流程

1. 全量跑 `bash scripts/quality-gate.sh` 与 `bash scripts/run-tests.sh`（本地或指向测试环境）
2. 确认评审报告无未修复的 Critical 问题
3. 整理变更清单（关联的任务编号、验收标准达成情况、遗留 Minor/Nit 问题清单）
4. 创建/更新 MR，描述中写入：变更清单、质量门结果、测试结果、评审结论、遗留问题
5. 明确标注：**需人工批准后合并**，并提醒审批人核查质量门与测试在 CI 的绿灯状态

本地跑通不替代 CI：两边脚本一致但环境不同（依赖源、缓存、配置），MR 创建后必须盯 CI 结果；CI 红灯时交付未完成，修复后重走本流程。

## Red Flags

| 想法 | 现实 |
|---|---|
| "质量门本地过了，CI 结果不用看" | 人工批准前必须确认 CI 绿灯，两边脚本一致但环境不同 |
| "AI 可以直接合并" | 合并决定权在人，AI 只做交付准备 |

## Verification

- [ ] MR 描述含质量门/测试/评审三项结果
- [ ] 人工批准要求已明确标注
