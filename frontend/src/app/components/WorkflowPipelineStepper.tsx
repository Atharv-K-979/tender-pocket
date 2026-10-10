"use client";

import React from 'react';
import { Tender } from '@/lib/db';
import { PIPELINE_STEPS, resolveTenderStageDetails } from '@/lib/tenderStatus';
import { AlertCircle, Clock, CheckCircle2 } from 'lucide-react';

interface WorkflowPipelineStepperProps {
  tender: Tender;
  currentUser?: { username: string; role: string } | null;
  showStageTitle?: boolean;
  showActionBanner?: boolean;
  onActionClick?: () => void;
}

export default function WorkflowPipelineStepper({
  tender,
  currentUser,
  showStageTitle = true,
  showActionBanner = false,
  onActionClick
}: WorkflowPipelineStepperProps) {
  const stage = resolveTenderStageDetails(tender, currentUser?.role);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
      {showStageTitle && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Current Stage: <strong style={{ color: stage.statusColor }}>{stage.stageName}</strong>
          </span>
          <span style={{
            fontSize: '11px',
            fontWeight: '700',
            padding: '2px 8px',
            borderRadius: '10px',
            backgroundColor: stage.badgeBg,
            color: stage.statusColor,
            border: `1px solid ${stage.badgeBorder}`
          }}>
            {stage.shortStage}
          </span>
        </div>
      )}

      {/* Stepper track */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', padding: '0 6px', margin: '4px 0' }}>
        {/* Inactive base line connecting 1 to 8 */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '16px',
          right: '16px',
          height: '2px',
          backgroundColor: 'var(--border-color)',
          zIndex: 0
        }} />

        {/* Active filled line */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '16px',
          width: `${stage.progressPercent}%`,
          height: '2px',
          backgroundColor: stage.isWon ? '#10b981' : stage.isLost ? '#ef4444' : 'var(--primary)',
          zIndex: 0,
          transition: 'width 0.3s ease'
        }} />

        {PIPELINE_STEPS.map((step, idx) => {
          const isDone = stage.stepCompleted[idx];
          const isCurrent = stage.currentStepIndex === idx && !stage.isWon && !stage.isLost;

          return (
            <div key={step.num} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, minWidth: '44px' }}>
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: isDone ? '#10b981' : isCurrent ? 'var(--primary)' : 'var(--bg-card)',
                border: isDone ? '2px solid #10b981' : isCurrent ? '2px solid var(--primary)' : '2px solid var(--border-color)',
                color: isDone || isCurrent ? '#fff' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: '700',
                boxShadow: isCurrent ? '0 0 10px rgba(99, 102, 241, 0.45)' : undefined,
                transition: 'all 0.2s ease'
              }}>
                {isDone ? '✓' : step.num}
              </div>
              <span style={{
                fontSize: '9.5px',
                marginTop: '4px',
                fontWeight: isCurrent ? '700' : isDone ? '600' : '500',
                color: isCurrent ? 'var(--text-primary)' : isDone ? 'var(--text-primary)' : 'var(--text-muted)',
                textAlign: 'center',
                whiteSpace: 'nowrap'
              }}>
                {step.short}
              </span>
            </div>
          );
        })}
      </div>

      {/* Action / Blocker Callout Banner */}
      {showActionBanner && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '12px 16px',
          borderRadius: '10px',
          background: stage.badgeBg,
          border: `1px solid ${stage.badgeBorder}`,
          marginTop: '6px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 280px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--bg-card)',
              color: stage.statusColor,
              flexShrink: 0
            }}>
              {stage.needsAction ? <AlertCircle size={18} /> : stage.isWon ? <CheckCircle2 size={18} /> : <Clock size={18} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '13px', fontWeight: '700', color: stage.statusColor }}>
                {stage.actionTitle}
              </span>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: '1.4' }}>
                {stage.actionDesc}
              </span>
            </div>
          </div>

          {onActionClick && (
            <button
              onClick={onActionClick}
              className="btn btn-primary"
              style={{
                fontSize: '12px',
                padding: '6px 14px',
                backgroundColor: stage.needsAction ? 'var(--primary)' : undefined
              }}
            >
              {stage.actionButtonText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
