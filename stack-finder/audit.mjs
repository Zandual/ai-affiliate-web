import { CATALOG, GENERAL_ASSISTANT_IDS } from './catalog.mjs';

const generalAssistantIds = new Set(GENERAL_ASSISTANT_IDS);
const specialistsById = new Map(CATALOG.map(tool => [tool.id, tool]));

// A missing cost is unknown, never an inferred subscription price or zero.
const enteredTotal = tools => tools.some(tool => tool.monthlyCost === null)
  ? null
  : tools.reduce((total, tool) => total + tool.monthlyCost, 0);

/**
 * Audit normalized existing tools separately from new-tool scoring.
 * Input: { primaryJob, existingTools: [{ toolId, monthlyCost: number|null }] }.
 * An overlap review identifies spend to examine; it does not promise savings.
 */
export function auditExistingTools({ primaryJob, existingTools }) {
  const generalAssistants = existingTools.filter(tool => generalAssistantIds.has(tool.toolId));
  const hasGeneralAssistant = generalAssistants.length > 0;
  const hasGeneralOverlap = generalAssistants.length > 1;
  const hasPrimarySpecialist = existingTools.some(tool =>
    specialistsById.get(tool.toolId)?.category === primaryJob);

  const audit = existingTools.map(({ toolId, monthlyCost }) => {
    if (generalAssistantIds.has(toolId)) {
      return {
        toolId,
        monthlyCost,
        status: hasGeneralOverlap ? 'REVIEW_OVERLAP' : 'KEEP',
        reasons: [hasGeneralOverlap
          ? 'These general assistants may overlap. Keep the one you actually use or prefer and review the others.'
          : 'Your existing general assistant covers general-purpose AI work.'],
      };
    }

    if (specialistsById.get(toolId)?.category === primaryJob) {
      return {
        toolId,
        monthlyCost,
        status: 'KEEP',
        reasons: ['Your existing specialist already covers the primary job you selected.'],
      };
    }

    return {
      toolId,
      monthlyCost,
      status: 'REVIEW',
      reasons: ['Review whether this tool still earns its place for your other work; this selected job does not establish its value.'],
    };
  });

  const currentUserEnteredMonthly = enteredTotal(existingTools);
  const currentKnownMonthly = existingTools.reduce((total, tool) =>
    total + (tool.monthlyCost ?? 0), 0);

  return {
    audit,
    hasGeneralAssistant,
    hasGeneralOverlap,
    hasPrimarySpecialist,
    cost: {
      currentUserEnteredMonthly,
      currentKnownMonthly,
      currentEstimatedMonthly: currentUserEnteredMonthly,
      recommendedNewMonthly: 0,
      recommendedEstimatedMonthly: currentUserEnteredMonthly,
      overlapReviewMonthly: hasGeneralOverlap ? enteredTotal(generalAssistants) : 0,
      estimatedSavingsMonthly: null,
    },
  };
}
