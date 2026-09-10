type QuestionnaireAnswers = Record<string, unknown>;

type PolicyProjection = {
  quoteData: Record<string, unknown>;
};

type RatingInputProjection = {
  quoteData: Record<string, unknown>;
};

function normalizeMotorQuestionnaireForProjection(answers: QuestionnaireAnswers): QuestionnaireAnswers {
  const quoteData: QuestionnaireAnswers = { ...answers };

  if (quoteData.hasClaims !== true) {
    delete quoteData.claimsDetails;
    delete quoteData.claimsCountLast5Years;
    delete quoteData.claimsTotalCostLast5Years;
    delete quoteData.maxFaultClaimCostLast5Years;
  }

  if (quoteData.hasConvictions !== true) {
    delete quoteData.convictionsDetails;
    delete quoteData.hasMajorConvictionLast5Years;
    delete quoteData.convictionClass;
    delete quoteData.majorConvictionWithinYears;
  } else if (quoteData.hasMajorConvictionLast5Years !== true && quoteData.convictionClass !== 'major') {
    delete quoteData.majorConvictionWithinYears;
  }

  if (quoteData.hasAdditionalDrivers !== true) {
    delete quoteData.youngestDriverAge;
    delete quoteData.otherDriversClaims;
    delete quoteData.otherDriversClaimsDetails;
    delete quoteData.otherDriversConvictions;
    delete quoteData.otherDriversConvictionsDetails;
    quoteData.additionalDrivers = [];
  }

  delete quoteData.garageTotalValue;

  return quoteData;
}

function asQuestionnaireAnswers(answers: unknown): QuestionnaireAnswers {
  return answers && typeof answers === 'object' && !Array.isArray(answers)
    ? (answers as QuestionnaireAnswers)
    : {};
}

export function questionnaireToPolicy(answers: unknown): PolicyProjection {
  return { quoteData: normalizeMotorQuestionnaireForProjection(asQuestionnaireAnswers(answers)) };
}

export function questionnaireToRating(answers: unknown): RatingInputProjection {
  return { quoteData: normalizeMotorQuestionnaireForProjection(asQuestionnaireAnswers(answers)) };
}
