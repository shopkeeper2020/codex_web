import { randomUUID } from 'node:crypto'
import type { EventBus } from './events.js'

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

export type PendingApproval = {
  id: string
  kind: 'command' | 'fileChange' | 'permissions'
  method: string
  threadId: string
  turnId: string
  itemId: string
  title: string
  body: string
  command: string | null
  cwd: string | null
  reason: string | null
  grantRoot: string | null
  filePath: string | null
  diff: string | null
  changedFiles: string[] | null
  proposedExecpolicyAmendment: string[] | null
  permissions: Record<string, unknown> | null
  createdAtIso: string
  status: 'pending'
}

type PendingApprovalRecord = {
  approval: PendingApproval
  resolve: (response: unknown) => void
  reject: (error: Error) => void
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.map((entry) => readString(entry)).filter(Boolean)
}

function readKind(method: string): PendingApproval['kind'] {
  if (method === 'item/fileChange/requestApproval') return 'fileChange'
  if (method === 'item/permissions/requestApproval') return 'permissions'
  return 'command'
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return asRecord(value)
}

function summarizePermissions(permissions: Record<string, unknown> | null): string {
  if (!permissions) return 'Agent 请求额外权限。'
  const fileSystem = asRecord(permissions.fileSystem) ?? asRecord(permissions.filesystem)
  const write = readStringArray(fileSystem?.write)
  const read = readStringArray(fileSystem?.read)
  const lines = [
    write && write.length > 0 ? `允许写入: ${write.join(', ')}` : '',
    read && read.length > 0 ? `允许读取: ${read.join(', ')}` : '',
    permissions.networkAccess === true || permissions.network === true ? '允许网络访问' : '',
  ].filter(Boolean)
  return lines.length > 0 ? lines.join('\n') : 'Agent 请求额外权限。'
}

export class ApprovalCoordinator {
  private pending = new Map<string, PendingApprovalRecord>()

  constructor(private readonly bus: EventBus) {}

  list(): PendingApproval[] {
    return [...this.pending.values()].map((record) => record.approval)
  }

  request(method: string, params: unknown): Promise<unknown> {
    const approval = this.buildApproval(method, params)
    return new Promise((resolve, reject) => {
      this.pending.set(approval.id, { approval, resolve, reject })
      this.bus.publish({ type: 'approval.requested', approval })
    })
  }

  decide(id: string, decision: ApprovalDecision): PendingApproval {
    const record = this.pending.get(id)
    if (!record) throw new Error('approval-not-found')
    this.pending.delete(id)
    record.resolve(this.buildResponse(record.approval, decision))
    this.bus.publish({ type: 'approval.resolved', approval: record.approval, decision })
    return record.approval
  }

  rejectAll(reason: string): void {
    for (const [id, record] of this.pending) {
      this.pending.delete(id)
      record.reject(new Error(reason))
      this.bus.publish({ type: 'approval.resolved', approval: record.approval, decision: 'cancel' })
    }
  }

  private buildApproval(method: string, params: unknown): PendingApproval {
    const record = asRecord(params) ?? {}
    const kind = readKind(method)
    const command = readString(record.command) || null
    const cwd = readString(record.cwd) || null
    const reason = readString(record.reason) || null
    const grantRoot = readString(record.grantRoot) || null
    const permissions = readRecord(record.permissions)
    const filePath = readString(record.filePath) || readString(record.file_path) || readString(record.path) || null
    const diff = readString(record.diff) || readString(record.patch) || null
    const changedFiles =
      readStringArray(record.changedFiles) ||
      readStringArray(record.changed_files) ||
      readStringArray(record.files)
    const proposedExecpolicyAmendment = readStringArray(record.proposedExecpolicyAmendment)
    const title = kind === 'fileChange'
      ? '批准文件变更'
      : kind === 'permissions'
        ? '批准权限请求'
        : '批准命令执行'
    const body = kind === 'fileChange'
      ? [
          filePath ? `文件: ${filePath}` : '',
          grantRoot ? `允许写入: ${grantRoot}` : 'Agent 请求应用文件变更。',
          reason,
        ].filter(Boolean).join('\n')
      : kind === 'permissions'
        ? [summarizePermissions(permissions), cwd ? `cwd: ${cwd}` : '', reason].filter(Boolean).join('\n')
        : [command ?? 'Agent 请求执行命令。', cwd ? `cwd: ${cwd}` : '', reason].filter(Boolean).join('\n')

    return {
      id: randomUUID(),
      kind,
      method,
      threadId: readString(record.threadId),
      turnId: readString(record.turnId),
      itemId: readString(record.itemId),
      title,
      body,
      command,
      cwd,
      reason,
      grantRoot,
      filePath,
      diff,
      changedFiles,
      proposedExecpolicyAmendment,
      permissions,
      createdAtIso: new Date().toISOString(),
      status: 'pending',
    }
  }

  private buildResponse(approval: PendingApproval, decision: ApprovalDecision): unknown {
    if (approval.kind === 'permissions') {
      if (decision !== 'accept' && decision !== 'acceptForSession') {
        return { permissions: {} }
      }
      return {
        permissions: approval.permissions ?? {},
        ...(decision === 'acceptForSession' ? { scope: 'session' } : {}),
      }
    }
    if (
      approval.kind === 'command' &&
      decision === 'acceptForSession' &&
      approval.proposedExecpolicyAmendment &&
      approval.proposedExecpolicyAmendment.length > 0
    ) {
      return {
        decision: {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: approval.proposedExecpolicyAmendment,
          },
        },
      }
    }
    return { decision }
  }
}
