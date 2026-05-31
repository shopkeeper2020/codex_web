import type { ReactElement } from 'react'
import styles from '../App.module.css'

export type StatusTone = 'ready' | 'warn' | 'idle'

export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }): ReactElement {
  return <span className={`${styles.statusBadge} ${styles[`statusBadge_${tone}`]}`}>{label}</span>
}
