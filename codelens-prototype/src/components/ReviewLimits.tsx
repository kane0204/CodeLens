import type { AiReviewResult, AiReviewSectionId, ScopedReviewResult } from '../types';

function limitMessages(limits: NonNullable<AiReviewResult['limits']>, section: AiReviewSectionId) {
  return [
    limits.facts_omitted.includes(section) && '本部分的静态证据超过输入预算，部分条目未发送。',
    limits.summary_compressed && '源码阅读记录已分层压缩，报告可能省略部分细节。',
    limits.reading_output_limited && '有批次的源码阅读记录达到模型输出上限。',
    limits.summary_output_limited && '有分层摘要达到模型输出上限。',
    limits.section_output_limited.includes(section) && '本部分报告达到模型输出上限，正文可能不完整。',
  ];
}

function legacyMessages(review: AiReviewResult | ScopedReviewResult) {
  return [
    review.omitted_context && '部分静态事实超出上下文上限，未全部发送。',
    review.truncated && '阅读记录或模型输出达到长度限制，当前解读可能不完整。',
  ];
}

export function ReviewLimits({ review, section }: {
  review: AiReviewResult | ScopedReviewResult | null;
  section: AiReviewSectionId;
}) {
  if (!review) return null;
  const messages = review.limits ? limitMessages(review.limits, section) : legacyMessages(review);
  const visible = messages.filter((message): message is string => Boolean(message));
  if (!visible.length) return null;
  return (
    <ul className="mt-2 space-y-1 rounded border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-xs text-warning">
      {visible.map((message) => <li key={message}>{message}</li>)}
    </ul>
  );
}
