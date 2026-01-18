// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// ... license text ...

import { SafeNumber } from '@/core/utils/types';
import { Injectable } from '@angular/core';

import { CoreError } from '@classes/errors/error';
import { CoreWSError } from '@classes/errors/wserror';
import { CoreCourseCommonModWSOptions } from '@features/course/services/course';
import { CoreCourseLogHelper } from '@features/course/services/log-helper';
import { CoreGradesFormattedItem, CoreGradesHelper } from '@features/grades/services/grades-helper';
import {
    CoreQuestion,
    CoreQuestionQuestionParsed,
    CoreQuestionQuestionWSData,
    CoreQuestionsAnswers,
} from '@features/question/services/question';
import { CoreQuestionDelegate } from '@features/question/services/question-delegate';
import { CoreSites, CoreSitesCommonWSOptions, CoreSitesReadingStrategy } from '@services/sites';
import { convertTextToHTMLElement } from '@/core/utils/create-html-element';
import { CoreTime } from '@singletons/time';
import { CoreUtils } from '@singletons/utils';
import { CoreStatusWithWarningsWSResponse, CoreWSExternalFile, CoreWSExternalWarning } from '@services/ws';
import { makeSingleton, Translate } from '@singletons';
import { CoreLogger } from '@singletons/logger';
import { ADDON_MOD_TABLETQUIZ_ACCESS_RULE_DELEGATE } from './access-rules-delegate';
import { ADDON_MOD_TABLETQUIZ_OFFLINE, ADDON_MOD_TABLETQUIZ_QUESTIONS_WITH_ANSWERS } from './TabletQuiz-offline';
import { CoreSiteWSPreSets } from '@classes/sites/authenticated-site';
import {
    QUESTION_INVALID_STATE_CLASSES,
    QUESTION_TODO_STATE_CLASSES,
    QuestionDisplayOptionsMarks,
    QuestionDisplayOptionsValues,
} from '@features/question/constants';
import {
    ADDON_MOD_TABLETQUIZ_ATTEMPT_FINISHED_EVENT,
    ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES,
    ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
    AddonModTabletQuizGradeMethods,
    AddonModTabletQuizDisplayOptionsAttemptStates,
    ADDON_MOD_TABLETQUIZ_IMMEDIATELY_AFTER_PERIOD,
    ADDON_MOD_TABLETQUIZ_NAV_METHODS,
} from '../constants';
import { CoreIonicColorNames } from '@singletons/colors';
import { CoreCacheUpdateFrequency } from '@/core/constants';
import { CoreObject } from '@singletons/object';
import { CoreArray } from '@singletons/array';
import { CoreTextFormat } from '@singletons/text';
import { CoreCourseModuleHelper, CoreCourseModuleStandardElements } from '@features/course/services/course-module-helper';

declare module '@singletons/events' {
    export interface CoreEventsData {
        [ADDON_MOD_TABLETQUIZ_ATTEMPT_FINISHED_EVENT]: AddonModTabletQuizAttemptFinishedData;
    }
}

/**
 * Service that provides some features for TabletQuiz.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletQuizProvider {

    protected static readonly ROOT_CACHE_KEY = 'mmaModTabletQuiz:';

    protected logger: CoreLogger;

    constructor() {
        this.logger = CoreLogger.getInstance('AddonModTabletQuizProvider');
    }

    /**
     * Formats a grade to be displayed.
     */
    formatGrade(grade?: number | null, decimals?: number): string {
        if (grade === undefined || grade === -1 || grade === null || isNaN(grade)) {
            return Translate.instant('addon.mod_tabletquiz.notyetgraded');
        }

        return CoreUtils.formatFloat(grade.toFixed(decimals ?? 2));
    }

    /**
     * Get attempt questions.
     *
     * @param TabletQuiz TabletQuiz object.
     * @param attempt Attempt.
     * @param preflightData Preflight required data (like password).
     * @param options Other options.
     * @returns Promise resolved with the questions.
     */
    async getAllQuestionsData(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        attempt: AddonModTabletQuizAttemptWSData,
        preflightData: Record<string, string>,
        options: AddonModTabletQuizAllQuestionsDataOptions = {},
    ): Promise<Record<number, CoreQuestionQuestionParsed>> {

        const questions: Record<number, CoreQuestionQuestionParsed> = {};
        const isSequential = this.isNavigationSequential(TabletQuiz);
        const pages = options.pages || this.getPagesFromLayout(attempt.layout);

        await Promise.all(pages.map(async (page) => {
            if (isSequential && page < (attempt.currentpage || 0)) {
                return;
            }

            const data = await this.getAttemptData(attempt.id, page, preflightData, options);

            data.questions.forEach((question) => {
                questions[question.slot] = question;
            });
        }));

        return questions;
    }
}


    /**
     * Get cache key for get attempt access information WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @param attemptId Attempt ID.
     * @returns Cache key.
     */
    protected getAttemptAccessInformationCacheKey(quizId: number, attemptId: number): string {
        return `${this.getAttemptAccessInformationCommonCacheKey(quizId)}:${attemptId}`;
    }

    /**
     * Get common cache key for get attempt access information WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getAttemptAccessInformationCommonCacheKey(quizId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}attemptAccessInformation:${quizId}`;
    }

    /**
     * Get access information for an attempt.
     *
     * @param quizId TabletQuiz ID.
     * @param attemptId Attempt ID. 0 for user's last attempt.
     * @param options Other options.
     * @returns Promise resolved with the access information.
     */
    async getAttemptAccessInformation(
        quizId: number,
        attemptId: number,
        options: CoreCourseCommonModWSOptions = {},
    ): Promise<AddonModTabletQuizGetAttemptAccessInformationWSResponse> {

        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletQuizGetAttemptAccessInformationWSParams = {
            quizid: quizId,
            attemptid: attemptId,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getAttemptAccessInformationCacheKey(quizId, attemptId),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        return site.read('mod_tabletquiz_get_attempt_access_information', params, preSets);
    }

    /**
     * Get cache key for get attempt data WS calls.
     *
     * @param attemptId Attempt ID.
     * @param page Page.
     * @returns Cache key.
     */
    protected getAttemptDataCacheKey(attemptId: number, page: number): string {
        return `${this.getAttemptDataCommonCacheKey(attemptId)}:${page}`;
    }

    /**
     * Get common cache key for get attempt data WS calls.
     *
     * @param attemptId Attempt ID.
     * @returns Cache key.
     */
    protected getAttemptDataCommonCacheKey(attemptId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}attemptData:${attemptId}`;
    }

    /**
     * Get an attempt's data.
     *
     * @param attemptId Attempt ID.
     * @param page Page number.
     * @param preflightData Preflight required data (like password).
     * @param options Other options.
     * @returns Promise resolved with the attempt data.
     */
    async getAttemptData(
        attemptId: number,
        page: number,
        preflightData: Record<string, string>,
        options: CoreCourseCommonModWSOptions = {},
    ): Promise<AddonModTabletQuizGetAttemptDataResponse> {

        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletQuizGetAttemptDataWSParams = {
            attemptid: attemptId,
            page: page,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
                true,
            ),
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getAttemptDataCacheKey(attemptId, page),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const result = await site.read<AddonModTabletQuizGetAttemptDataWSResponse>('mod_tabletquiz_get_attempt_data', params, preSets);

        result.questions = CoreQuestion.parseQuestions(result.questions);

        return result;
    }

    /**
     * Get an attempt's due date.
     *
     * @param TabletQuiz TabletQuiz.
     * @param attempt Attempt.
     * @returns Attempt's due date, 0 if no due date or invalid data.
     */
    getAttemptDueDate(TabletQuiz: AddonModTabletQuizQuizWSData, attempt: AddonModTabletQuizAttemptWSData): number {
        const deadlines: number[] = [];

        if (TabletQuiz.timelimit && attempt.timestart) {
            deadlines.push(attempt.timestart + TabletQuiz.timelimit);
        }
        if (TabletQuiz.timeclose) {
            deadlines.push(TabletQuiz.timeclose);
        }

        if (!deadlines.length) {
            return 0;
        }

        // Get min due date.
        const dueDate: number = Math.min.apply(null, deadlines);
        if (!dueDate) {
            return 0;
        }

        switch (attempt.state) {
            case ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.IN_PROGRESS:
                return dueDate * 1000;

            case ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.OVERDUE:
                return (dueDate + (TabletQuiz.graceperiod ?? 0)) * 1000;

            default:
                this.logger.warn(`Unexpected state when getting due date: ${attempt.state}`);

                return 0;
        }
    }

    /**
     * Get an attempt's warning because of due date.
     *
     * @param TabletQuiz TabletQuiz.
     * @param attempt Attempt.
     * @returns Attempt's warning, undefined if no due date.
     */
    getAttemptDueDateWarning(TabletQuiz: AddonModTabletQuizQuizWSData, attempt: AddonModTabletQuizAttemptWSData): string | undefined {
        const dueDate = this.getAttemptDueDate(TabletQuiz, attempt);

        if (attempt.state === ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.OVERDUE) {
            return Translate.instant(
                'addon.mod_tabletquiz.overduemustbesubmittedby',
                { $a: CoreTime.userDate(dueDate) },
            );
        } else if (dueDate) {
            return Translate.instant('addon.mod_tabletquiz.mustbesubmittedby', { $a: CoreTime.userDate(dueDate) });
        }
    }

    /**
     * Get the display option value related to the attempt state.
     * Equivalent to LMS quiz_attempt_state.
     *
     * @param TabletQuiz TabletQuiz.
     * @param attempt Attempt.
     * @returns Display option value.
     */
    getAttemptStateDisplayOption(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        attempt: AddonModTabletQuizAttemptWSData,
    ): AddonModTabletQuizDisplayOptionsAttemptStates {
        if (attempt.state === ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.IN_PROGRESS) {
            return AddonModTabletQuizDisplayOptionsAttemptStates.DURING;
        } else if (TabletQuiz.timeclose && Date.now() >= TabletQuiz.timeclose * 1000) {
            return AddonModTabletQuizDisplayOptionsAttemptStates.AFTER_CLOSE;
        } else if (Date.now() < ((attempt.timefinish ?? 0) + ADDON_MOD_TABLETQUIZ_IMMEDIATELY_AFTER_PERIOD) * 1000) {
            return AddonModTabletQuizDisplayOptionsAttemptStates.IMMEDIATELY_AFTER;
        }

        return AddonModTabletQuizDisplayOptionsAttemptStates.LATER_WHILE_OPEN;
    }

    /**
     * Get display options for a certain TabletQuiz.
     * Equivalent to LMS display_options::make_from_quiz.
     *
     * @param TabletQuiz TabletQuiz.
     * @param state State.
     * @returns Display options.
     */
    getDisplayOptionsForQuiz(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        state: AddonModTabletQuizDisplayOptionsAttemptStates,
    ): AddonModTabletQuizDisplayOptions {
        const marksOption = this.calculateDisplayOptionValue(
            TabletQuiz.reviewmarks ?? 0,
            state,
            QuestionDisplayOptionsMarks.MARK_AND_MAX,
            QuestionDisplayOptionsMarks.MAX_ONLY,
        );
        const feedbackOption = this.calculateDisplayOptionValue(TabletQuiz.reviewspecificfeedback ?? 0, state);

        return {
            attempt: this.calculateDisplayOptionValue(TabletQuiz.reviewattempt ?? 0, state, true, false),
            correctness: this.calculateDisplayOptionValue(TabletQuiz.reviewcorrectness ?? 0, state),
            marks: TabletQuiz.reviewmaxmarks !== undefined ?
                this.calculateDisplayOptionValue<QuestionDisplayOptionsMarks | QuestionDisplayOptionsValues>(
                    TabletQuiz.reviewmaxmarks,
                    state,
                    marksOption,
                    QuestionDisplayOptionsValues.HIDDEN,
                ) :
                marksOption,
            feedback: feedbackOption,
            generalfeedback: this.calculateDisplayOptionValue(TabletQuiz.reviewgeneralfeedback ?? 0, state),
            rightanswer: this.calculateDisplayOptionValue(TabletQuiz.reviewrightanswer ?? 0, state),
            overallfeedback: this.calculateDisplayOptionValue(TabletQuiz.reviewoverallfeedback ?? 0, state),
            numpartscorrect: feedbackOption,
            manualcomment: feedbackOption,
            markdp: TabletQuiz.questiondecimalpoints !== undefined && TabletQuiz.questiondecimalpoints !== -1 ?
                TabletQuiz.questiondecimalpoints :
                (TabletQuiz.decimalpoints ?? 0),
        };
    }

    /**
     * Calculate the value for a certain display option.
     *
     * @param setting Setting value related to the option.
     * @param state Display options state.
     * @param whenSet Value to return if setting is set.
     * @param whenNotSet Value to return if setting is not set.
     * @returns Display option.
     */
    protected calculateDisplayOptionValue<T = AddonModTabletQuizDisplayOptionValue>(
        setting: number,
        state: AddonModTabletQuizDisplayOptionsAttemptStates,
        whenSet: T,
        whenNotSet: T,
    ): T;
    protected calculateDisplayOptionValue(
        setting: number,
        state: AddonModTabletQuizDisplayOptionsAttemptStates,
    ): QuestionDisplayOptionsValues;
    protected calculateDisplayOptionValue(
        setting: number,
        state: AddonModTabletQuizDisplayOptionsAttemptStates,
        whenSet: AddonModTabletQuizDisplayOptionValue = QuestionDisplayOptionsValues.VISIBLE,
        whenNotSet: AddonModTabletQuizDisplayOptionValue = QuestionDisplayOptionsValues.HIDDEN,
    ): AddonModTabletQuizDisplayOptionValue {
        // eslint-disable-next-line no-bitwise
        if (setting & state) {
            return whenSet;
        }

        return whenNotSet;
    }

    /**
     * Turn attempt's state into a readable state name.
     *
     * @param state State.
     * @param finishedOffline Whether the attempt was finished offline.
     * @returns Readable state name.
     */
    getAttemptReadableStateName(state: string, finishedOffline = false): string {
        if (finishedOffline) {
            return Translate.instant('core.submittedoffline');
        }

        switch (state) {
            case ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.IN_PROGRESS:
                return Translate.instant('addon.mod_tabletquiz.stateinprogress');

            case ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.OVERDUE:
                return Translate.instant('addon.mod_tabletquiz.stateoverdue');

            case ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.FINISHED:
                return Translate.instant('addon.mod_tabletquiz.statefinished');

            case ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.ABANDONED:
                return Translate.instant('addon.mod_tabletquiz.stateabandoned');

            default:
                return '';
        }
    }

    /**
     * Get the color to apply to the attempt state.
     *
     * @param state State.
     * @param finishedOffline Whether the attempt was finished offline.
     * @returns State color.
     */
    getAttemptStateColor(state: string, finishedOffline = false): string {
        if (finishedOffline) {
            return CoreIonicColorNames.MEDIUM;
        }

        switch (state) {
            case ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.IN_PROGRESS:
                return CoreIonicColorNames.WARNING;

            case ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.OVERDUE:
                return CoreIonicColorNames.INFO;

            case ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.FINISHED:
                return CoreIonicColorNames.SUCCESS;

            case ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.ABANDONED:
                return CoreIonicColorNames.DANGER;

            default:
                return '';
        }
    }

    /**
     * Get cache key for get attempt review WS calls.
     *
     * @param attemptId Attempt ID.
     * @param page Page.
     * @returns Cache key.
     */
    protected getAttemptReviewCacheKey(attemptId: number, page: number): string {
        return `${this.getAttemptReviewCommonCacheKey(attemptId)}:${page}`;
    }

    /**
     * Get common cache key for get attempt review WS calls.
     *
     * @param attemptId Attempt ID.
     * @returns Cache key.
     */
    protected getAttemptReviewCommonCacheKey(attemptId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}attemptReview:${attemptId}`;
    }

    /**
     * Get an attempt's review.
     *
     * @param attemptId Attempt ID.
     * @param options Other options.
     * @returns Promise resolved with the attempt review.
     */
    async getAttemptReview(
        attemptId: number,
        options: AddonModTabletQuizGetAttemptReviewOptions = {},
    ): Promise<AddonModTabletQuizGetAttemptReviewResponse> {
        const page = options.page === undefined ? -1 : options.page;

        const site = await CoreSites.getSite(options.siteId);

        const params = {
            attemptid: attemptId,
            page: page,
        };
        const preSets = {
            cacheKey: this.getAttemptReviewCacheKey(attemptId, page),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            deleteCacheIfWSError: true,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const result = await site.read<AddonModTabletQuizGetAttemptReviewWSResponse>('mod_tabletquiz_get_attempt_review', params, preSets);

        result.questions = CoreQuestion.parseQuestions(result.questions);

        return result;
    }

    /**
     * Get cache key for get attempt summary WS calls.
     *
     * @param attemptId Attempt ID.
     * @returns Cache key.
     */
    protected getAttemptSummaryCacheKey(attemptId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}attemptSummary:${attemptId}`;
    }

    /**
     * Get an attempt's summary.
     *
     * @param attemptId Attempt ID.
     * @param preflightData Preflight required data (like password).
     * @param options Other options.
     * @returns Promise resolved with the list of questions for the attempt summary.
     */
    async getAttemptSummary(
        attemptId: number,
        preflightData: Record<string, string>,
        options: AddonModTabletQuizGetAttemptSummaryOptions = {},
    ): Promise<CoreQuestionQuestionParsed[]> {

        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletQuizGetAttemptSummaryWSParams = {
            attemptid: attemptId,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
                true,
            ),
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getAttemptSummaryCacheKey(attemptId),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const response = await site.read<AddonModTabletQuizGetAttemptSummaryWSResponse>('mod_tabletquiz_get_attempt_summary', params, preSets);

        const questions = CoreQuestion.parseQuestions(response.questions);

        if (options.loadLocal) {
            await ADDON_MOD_TABLETQUIZ_OFFLINE.loadQuestionsLocalStates(attemptId, questions, site.getId());
        }

        return questions;
    }

    /**
     * Get cache key for get combined review options WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @param userId User ID.
     * @returns Cache key.
     */
    protected getCombinedReviewOptionsCacheKey(quizId: number, userId: number): string {
        return `${this.getCombinedReviewOptionsCommonCacheKey(quizId)}:${userId}`;
    }

    /**
     * Get common cache key for get combined review options WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getCombinedReviewOptionsCommonCacheKey(quizId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}combinedReviewOptions:${quizId}`;
    }

    /**
     * Get a TabletQuiz combined review options.
     *
     * @param quizId TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved with the combined review options.
     */
    async getCombinedReviewOptions(
        quizId: number,
        options: AddonModTabletQuizUserOptions = {},
    ): Promise<AddonModTabletQuizCombinedReviewOptions> {
        const site = await CoreSites.getSite(options.siteId);

        const userId = options.userId || site.getUserId();
        const params: AddonModTabletQuizGetCombinedReviewOptionsWSParams = {
            quizid: quizId,
            userid: userId,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getCombinedReviewOptionsCacheKey(quizId, userId),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const response = await site.read<AddonModTabletQuizGetCombinedReviewOptionsWSResponse>(
            'mod_tabletquiz_get_combined_review_options',
            params,
            preSets,
        );

        // Convert the arrays to objects with name -> value.
        return {
            someoptions: <Record<string, number>> CoreObject.toKeyValueMap(response.someoptions, 'name', 'value'),
            alloptions: <Record<string, number>> CoreObject.toKeyValueMap(response.alloptions, 'name', 'value'),
            warnings: response.warnings,
        };
    }

    /**
     * Get cache key for get feedback for grade WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @param grade Grade.
     * @returns Cache key.
     */
    protected getFeedbackForGradeCacheKey(quizId: number, grade: number): string {
        return `${this.getFeedbackForGradeCommonCacheKey(quizId)}:${grade}`;
    }

    /**
     * Get common cache key for get feedback for grade WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getFeedbackForGradeCommonCacheKey(quizId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}feedbackForGrade:${quizId}`;
    }

    /**
     * Get the feedback for a certain grade.
     *
     * @param quizId TabletQuiz ID.
     * @param grade Grade.
     * @param options Other options.
     * @returns Promise resolved with the feedback.
     */
    async getFeedbackForGrade(
        quizId: number,
        grade: SafeNumber,
        options: CoreCourseCommonModWSOptions = {},
    ): Promise<AddonModTabletQuizGetQuizFeedbackForGradeWSResponse> {
        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletQuizGetQuizFeedbackForGradeWSParams = {
            quizid: quizId,
            grade: grade,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getFeedbackForGradeCacheKey(quizId, grade),
            updateFrequency: CoreCacheUpdateFrequency.RARELY,
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        return site.read('mod_tabletquiz_get_quiz_feedback_for_grade', params, preSets);
    }

    /**
     * Determine the correct number of decimal places required to format a grade.
     * Based on Moodle's quiz_get_grade_format.
     *
     * @param TabletQuiz TabletQuiz.
     * @returns Number of decimals.
     */
    getGradeDecimals(TabletQuiz: AddonModTabletQuizQuizWSData): number {
        if (TabletQuiz.questiondecimalpoints === undefined) {
            TabletQuiz.questiondecimalpoints = -1;
        }

        if (TabletQuiz.questiondecimalpoints == -1) {
            return TabletQuiz.decimalpoints ?? 1;
        }

        return TabletQuiz.questiondecimalpoints;
    }

    /**
     * Gets a TabletQuiz grade and feedback from the gradebook.
     *
     * @param courseId Course ID.
     * @param moduleId TabletQuiz module ID.
     * @param ignoreCache Whether it should ignore cached data (it will always fail in offline or server down).
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined use site's current user.
     * @returns Promise resolved with an object containing the grade and the feedback.
     */
    async getGradeFromGradebook(
        courseId: number,
        moduleId: number,
        ignoreCache?: boolean,
        siteId?: string,
        userId?: number,
    ): Promise<CoreGradesFormattedItem | undefined> {

        const items = await CoreGradesHelper.getGradeModuleItems(
            courseId,
            moduleId,
            userId,
            undefined,
            siteId,
            ignoreCache,
        );

        return items.shift();
    }

    /**
     * Given a list of attempts, returns the last completed attempt.
     *
     * @param attempts Attempts sorted. First attempt should be the first on the list.
     * @returns Last completed attempt.
     */
    getLastCompletedAttemptFromList(attempts?: AddonModTabletQuizAttemptWSData[]): AddonModTabletQuizAttemptWSData | undefined {
        if (!attempts) {
            return;
        }

        for (let i = attempts.length - 1; i >= 0; i--) {
            const attempt = attempts[i];

            if (this.isAttemptCompleted(attempt.state)) {
                return attempt;
            }
        }
    }

    /**
     * Given a list of questions, check if the TabletQuiz can be submitted.
     * Will return an array with the messages to prevent the submit. Empty array if TabletQuiz can be submitted.
     *
     * @param questions Questions.
     * @returns List of prevent submit messages. Empty array if TabletQuiz can be submitted.
     */
    getPreventSubmitMessages(questions: CoreQuestionQuestionParsed[]): string[] {
        const messages: string[] = [];

        questions.forEach((question) => {
            if (question.type != 'random' && !CoreQuestionDelegate.isQuestionSupported(question.type)) {
                // The question isn't supported.
                messages.push(Translate.instant('core.question.questionmessage', {
                    $a: question.slot,
                    $b: Translate.instant('core.question.errorquestionnotsupported', { $a: question.type }),
                }));
            } else {
                let message = CoreQuestionDelegate.getPreventSubmitMessage(question);
                if (message) {
                    message = Translate.instant(message);
                    messages.push(Translate.instant('core.question.questionmessage', { $a: question.slot, $b: message }));
                }
            }
        });

        return messages;
    }

    /**
     * Get cache key for TabletQuiz data WS calls.
     *
     * @param courseId Course ID.
     * @returns Cache key.
     */
    protected getQuizDataCacheKey(courseId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}TabletQuiz:${courseId}`;
    }

    /**
     * Get a TabletQuiz with key=value. If more than one is found, only the first will be returned.
     *
     * @param courseId Course ID.
     * @param key Name of the property to check.
     * @param value Value to search.
     * @param options Other options.
     * @returns Promise resolved when the TabletQuiz is retrieved.
     */
    protected async getQuizByField(
        courseId: number,
        key: 'coursemodule' | 'id',
        value: number,
        options: CoreSitesCommonWSOptions = {},
    ): Promise<AddonModTabletQuizQuizWSData> {

        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletQuizGetQuizzesByCoursesWSParams = {
            courseids: [courseId],
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getQuizDataCacheKey(courseId),
            updateFrequency: CoreCacheUpdateFrequency.RARELY,
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const response = await site.read<AddonModTabletQuizGetQuizzesByCoursesWSResponse>(
            'mod_tabletquiz_get_quizzes_by_courses',
            params,
            preSets,
        );

        // Search the TabletQuiz.
        return CoreCourseModuleHelper.getActivityByField(response.quizzes, key, value);
    }

    /**
     * Get a TabletQuiz by module ID.
     *
     * @param courseId Course ID.
     * @param cmId Course module ID.
     * @param options Other options.
     * @returns Promise resolved when the TabletQuiz is retrieved.
     */
    getQuiz(courseId: number, cmId: number, options: CoreSitesCommonWSOptions = {}): Promise<AddonModTabletQuizQuizWSData> {
        return this.getQuizByField(courseId, 'coursemodule', cmId, options);
    }

    /**
     * Get a TabletQuiz by TabletQuiz ID.
     *
     * @param courseId Course ID.
     * @param id TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved when the TabletQuiz is retrieved.
     */
    getQuizById(courseId: number, id: number, options: CoreSitesCommonWSOptions = {}): Promise<AddonModTabletQuizQuizWSData> {
        return this.getQuizByField(courseId, 'id', id, options);
    }

    /**
     * Get cache key for get TabletQuiz access information WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getQuizAccessInformationCacheKey(quizId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}quizAccessInformation:${quizId}`;
    }

    /**
     * Get access information for an attempt.
     *
     * @param quizId TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved with the access information.
     */
    async getQuizAccessInformation(
        quizId: number,
        options: CoreCourseCommonModWSOptions = {},
    ): Promise<AddonModTabletQuizGetQuizAccessInformationWSResponse> {
        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletQuizGetQuizAccessInformationWSParams = {
            quizid: quizId,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getQuizAccessInformationCacheKey(quizId),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        return site.read('mod_tabletquiz_get_quiz_access_information', params, preSets);
    }

    /**
     * Get a readable TabletQuiz grade method.
     *
     * @param method Grading method.
     * @returns Readable grading method.
     */
    getQuizGradeMethod(method?: number | string): string {
        if (method === undefined) {
            return '';
        }

        if (typeof method == 'string') {
            method = parseInt(method, 10);
        }

        switch (method) {
            case AddonModTabletQuizGradeMethods.HIGHEST_GRADE:
                return Translate.instant('addon.mod_tabletquiz.gradehighest');
            case AddonModTabletQuizGradeMethods.AVERAGE_GRADE:
                return Translate.instant('addon.mod_tabletquiz.gradeaverage');
            case AddonModTabletQuizGradeMethods.FIRST_ATTEMPT:
                return Translate.instant('addon.mod_tabletquiz.attemptfirst');
            case AddonModTabletQuizGradeMethods.LAST_ATTEMPT:
                return Translate.instant('addon.mod_tabletquiz.attemptlast');
            default:
                return '';
        }
    }

    /**
     * Get cache key for get TabletQuiz required qtypes WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getQuizRequiredQtypesCacheKey(quizId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}quizRequiredQtypes:${quizId}`;
    }

    /**
     * Get the potential question types that would be required for a given TabletQuiz.
     *
     * @param quizId TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved with the access information.
     */
    async getQuizRequiredQtypes(quizId: number, options: CoreCourseCommonModWSOptions = {}): Promise<string[]> {
        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletQuizGetQuizRequiredQtypesWSParams = {
            quizid: quizId,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getQuizRequiredQtypesCacheKey(quizId),
            updateFrequency: CoreCacheUpdateFrequency.SOMETIMES,
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const response = await site.read<AddonModTabletQuizGetQuizRequiredQtypesWSResponse>(
            'mod_tabletquiz_get_quiz_required_qtypes',
            params,
            preSets,
        );

        return response.questiontypes;
    }

    /**
     * Given an attempt's layout, return the list of pages.
     *
     * @param layout Attempt's layout.
     * @returns Pages.
     * @description
     * An attempt's layout is a string with the question numbers separated by commas. A 0 indicates a change of page.
     * Example: 1,2,3,0,4,5,6,0
     * In the example above, first page has questions 1, 2 and 3. Second page has questions 4, 5 and 6.
     *
     * This function returns a list of pages.
     */
    getPagesFromLayout(layout?: string): number[] {
        if (!layout) {
            return [];
        }

        const split = layout.split(',');
        const pages: number[] = [];
        let page = 0;

        for (let i = 0; i < split.length; i++) {
            if (split[i] == '0') {
                pages.push(page);
                page++;
            }
        }

        return pages;
    }

    /**
     * Given an attempt's layout and a list of questions identified by question slot,
     * return the list of pages that have at least 1 of the questions.
     *
     * @param layout Attempt's layout.
     * @param questions List of questions. It needs to be an object where the keys are question slot.
     * @returns Pages.
     * @description
     * An attempt's layout is a string with the question numbers separated by commas. A 0 indicates a change of page.
     * Example: 1,2,3,0,4,5,6,0
     * In the example above, first page has questions 1, 2 and 3. Second page has questions 4, 5 and 6.
     *
     * This function returns a list of pages.
     */
    getPagesFromLayoutAndQuestions(layout: string, questions: ADDON_MOD_TABLETQUIZ_QUESTIONS_WITH_ANSWERS): number[] {
        const split = layout.split(',');
        const pages: number[] = [];
        let page = 0;
        let pageAdded = false;

        for (let i = 0; i < split.length; i++) {
            const value = Number(split[i]);

            if (value == 0) {
                page++;
                pageAdded = false;
            } else if (!pageAdded && questions[value]) {
                pages.push(page);
                pageAdded = true;
            }
        }

        return pages;
    }

    /**
     * Given a list of question types, returns the types that aren't supported.
     *
     * @param questionTypes Question types to check.
     * @returns Not supported question types.
     */
    getUnsupportedQuestions(questionTypes: string[]): string[] {
        const notSupported: string[] = [];

        questionTypes.forEach((type) => {
            if (type != 'random' && !CoreQuestionDelegate.isQuestionSupported(type)) {
                notSupported.push(type);
            }
        });

        return notSupported;
    }

    /**
     * Given a list of access rules names, returns the rules that aren't supported.
     *
     * @param rulesNames Rules to check.
     * @returns Not supported rules names.
     */
    getUnsupportedRules(rulesNames: string[]): string[] {
        const notSupported: string[] = [];

        rulesNames.forEach((name) => {
            if (!ADDON_MOD_TABLETQUIZ_ACCESS_RULE_DELEGATE.isAccessRuleSupported(name)) {
                notSupported.push(name);
            }
        });

        return notSupported;
    }

    /**
     * Get cache key for get user attempts WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @param userId User ID.
     * @returns Cache key.
     */
    protected getUserAttemptsCacheKey(quizId: number, userId: number): string {
        return `${this.getUserAttemptsCommonCacheKey(quizId)}:${userId}`;
    }

    /**
     * Get common cache key for get user attempts WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getUserAttemptsCommonCacheKey(quizId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}userAttempts:${quizId}`;
    }

    /**
     * Get TabletQuiz attempts for a certain user.
     *
     * @param quizId TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved with the attempts.
     */
    async getUserAttempts(
        quizId: number,
        options: AddonModTabletQuizGetUserAttemptsOptions = {},
    ): Promise<AddonModTabletQuizAttemptWSData[]> {

        const status = options.status || 'all';
        const includePreviews = options.includePreviews === undefined ? true : options.includePreviews;

        const site = await CoreSites.getSite(options.siteId);

        const userId = options.userId || site.getUserId();
        const params: AddonModTabletQuizGetUserAttemptsWSParams = {
            quizid: quizId,
            userid: userId,
            status: status,
            includepreviews: !!includePreviews,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getUserAttemptsCacheKey(quizId, userId),
            updateFrequency: CoreCacheUpdateFrequency.SOMETIMES,
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const response = await site.read<AddonModTabletQuizGetUserAttemptsWSResponse>('mod_tabletquiz_get_user_attempts', params, preSets);

        return response.attempts;
    }

    /**
     * Get cache key for get user best grade WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @param userId User ID.
     * @returns Cache key.
     */
    protected getUserBestGradeCacheKey(quizId: number, userId: number): string {
        return `${this.getUserBestGradeCommonCacheKey(quizId)}:${userId}`;
    }

    /**
     * Get common cache key for get user best grade WS calls.
     *
     * @param quizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getUserBestGradeCommonCacheKey(quizId: number): string {
        return `${AddonModTabletQuizProvider.ROOT_CACHE_KEY}userBestGrade:${quizId}`;
    }

    /**
     * Get best grade in a TabletQuiz for a certain user.
     *
     * @param quizId TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved with the best grade data.
     */
    async getUserBestGrade(quizId: number, options: AddonModTabletQuizUserOptions = {}): Promise<AddonModTabletQuizGetUserBestGradeWSResponse> {
        const site = await CoreSites.getSite(options.siteId);

        const userId = options.userId || site.getUserId();
        const params: AddonModTabletQuizGetUserBestGradeWSParams = {
            quizid: quizId,
            userid: userId,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getUserBestGradeCacheKey(quizId, userId),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        return site.read('mod_tabletquiz_get_user_best_grade', params, preSets);
    }

    /**
     * Invalidates all the data related to a certain TabletQuiz.
     *
     * @param quizId TabletQuiz ID.
     * @param courseId Course ID.
     * @param attemptId Attempt ID to invalidate some WS calls.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined use site's current user.
     */
    async invalidateAllQuizData(
        quizId: number,
        courseId?: number,
        attemptId?: number,
        siteId?: string,
        userId?: number,
    ): Promise<void> {
        siteId = siteId || CoreSites.getCurrentSiteId();

        const promises: Promise<void>[] = [];

        promises.push(this.invalidateAttemptAccessInformation(quizId, siteId));
        promises.push(this.invalidateCombinedReviewOptionsForUser(quizId, siteId, userId));
        promises.push(this.invalidateFeedback(quizId, siteId));
        promises.push(this.invalidateQuizAccessInformation(quizId, siteId));
        promises.push(this.invalidateQuizRequiredQtypes(quizId, siteId));
        promises.push(this.invalidateUserAttemptsForUser(quizId, siteId, userId));
        promises.push(this.invalidateUserBestGradeForUser(quizId, siteId, userId));

        if (attemptId) {
            promises.push(this.invalidateAttemptData(attemptId, siteId));
            promises.push(this.invalidateAttemptReview(attemptId, siteId));
            promises.push(this.invalidateAttemptSummary(attemptId, siteId));
        }

        if (courseId) {
            promises.push(this.invalidateGradeFromGradebook(courseId, siteId, userId));
        }

        await Promise.all(promises);
    }

    /**
     * Invalidates attempt access information for all attempts in a TabletQuiz.
     *
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateAttemptAccessInformation(quizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getAttemptAccessInformationCommonCacheKey(quizId));
    }

    /**
     * Invalidates attempt access information for an attempt.
     *
     * @param quizId TabletQuiz ID.
     * @param attemptId Attempt ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateAttemptAccessInformationForAttempt(quizId: number, attemptId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getAttemptAccessInformationCacheKey(quizId, attemptId));
    }

    /**
     * Invalidates attempt data for all pages.
     *
     * @param attemptId Attempt ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateAttemptData(attemptId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getAttemptDataCommonCacheKey(attemptId));
    }

    /**
     * Invalidates attempt data for a certain page.
     *
     * @param attemptId Attempt ID.
     * @param page Page.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateAttemptDataForPage(attemptId: number, page: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getAttemptDataCacheKey(attemptId, page));
    }

    /**
     * Invalidates attempt review for all pages.
     *
     * @param attemptId Attempt ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateAttemptReview(attemptId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getAttemptReviewCommonCacheKey(attemptId));
    }

    /**
     * Invalidates attempt review for a certain page.
     *
     * @param attemptId Attempt ID.
     * @param page Page.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateAttemptReviewForPage(attemptId: number, page: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getAttemptReviewCacheKey(attemptId, page));
    }

    /**
     * Invalidates attempt summary.
     *
     * @param attemptId Attempt ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateAttemptSummary(attemptId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getAttemptSummaryCacheKey(attemptId));
    }

    /**
     * Invalidates combined review options for all users.
     *
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateCombinedReviewOptions(quizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getCombinedReviewOptionsCommonCacheKey(quizId));
    }

    /**
     * Invalidates combined review options for a certain user.
     *
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined use site's current user.
     */
    async invalidateCombinedReviewOptionsForUser(quizId: number, siteId?: string, userId?: number): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getCombinedReviewOptionsCacheKey(quizId, userId || site.getUserId()));
    }

    /**
     * Invalidate the prefetched content except files.
     *
     * @param moduleId The module ID.
     * @param courseId Course ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateContent(moduleId: number, courseId: number, siteId?: string): Promise<void> {
        siteId = siteId || CoreSites.getCurrentSiteId();

        // Get required data to call the invalidate functions.
        const TabletQuiz = await this.getQuiz(courseId, moduleId, {
            readingStrategy: CoreSitesReadingStrategy.PREFER_CACHE,
            siteId,
        });

        const attempts = await this.getUserAttempts(TabletQuiz.id, { cmId: moduleId, siteId });

        // Now invalidate it.
        const lastAttemptId = attempts.length ? attempts[attempts.length - 1].id : undefined;

        await this.invalidateAllQuizData(TabletQuiz.id, courseId, lastAttemptId, siteId);
    }

    /**
     * Invalidates feedback for all grades of a TabletQuiz.
     *
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateFeedback(quizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getFeedbackForGradeCommonCacheKey(quizId));
    }

    /**
     * Invalidates feedback for a certain grade.
     *
     * @param quizId TabletQuiz ID.
     * @param grade Grade.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateFeedbackForGrade(quizId: number, grade: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getFeedbackForGradeCacheKey(quizId, grade));
    }

    /**
     * Invalidates grade from gradebook for a certain user.
     *
     * @param courseId Course ID.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined use site's current user.
     */
    async invalidateGradeFromGradebook(courseId: number, siteId?: string, userId?: number): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await CoreGradesHelper.invalidateGradeModuleItems(courseId, userId || site.getUserId(), undefined, siteId);
    }

    /**
     * Invalidates TabletQuiz access information for a TabletQuiz.
     *
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateQuizAccessInformation(quizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getQuizAccessInformationCacheKey(quizId));
    }

    /**
     * Invalidates required qtypes for a TabletQuiz.
     *
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateQuizRequiredQtypes(quizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getQuizRequiredQtypesCacheKey(quizId));
    }

    /**
     * Invalidates user attempts for all users.
     *
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateUserAttempts(quizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getUserAttemptsCommonCacheKey(quizId));
    }

    /**
     * Invalidates user attempts for a certain user.
     *
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined use site's current user.
     */
    async invalidateUserAttemptsForUser(quizId: number, siteId?: string, userId?: number): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getUserAttemptsCacheKey(quizId, userId || site.getUserId()));
    }

    /**
     * Invalidates user best grade for all users.
     *
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateUserBestGrade(quizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getUserBestGradeCommonCacheKey(quizId));
    }

    /**
     * Invalidates user best grade for a certain user.
     *
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined use site's current user.
     */
    async invalidateUserBestGradeForUser(quizId: number, siteId?: string, userId?: number): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getUserBestGradeCacheKey(quizId, userId || site.getUserId()));
    }

    /**
     * Invalidates TabletQuiz data.
     *
     * @param courseId Course ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateQuizData(courseId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getQuizDataCacheKey(courseId));
    }

    /**
     * Check if an attempt is "completed": finished or abandoned.
     *
     * @param state Attempt's state.
     * @returns Whether it's finished.
     */
    isAttemptCompleted(state?: string): boolean {
        return state === ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.FINISHED || state === ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.ABANDONED;
    }

    /**
     * Check if an attempt is finished in offline but not synced.
     *
     * @param attemptId Attempt ID.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with boolean: true if finished in offline but not synced, false otherwise.
     */
    async isAttemptFinishedOffline(attemptId: number, siteId?: string): Promise<boolean> {
        try {
            const attempt = await ADDON_MOD_TABLETQUIZ_OFFLINE.getAttemptById(attemptId, siteId);

            return !!attempt.finished;
        } catch {
            return false;
        }
    }

    /**
     * Check if an attempt is nearly over. We consider an attempt nearly over or over if:
     * - Is not in progress
     * OR
     * - It finished before autosaveperiod passes.
     *
     * @param TabletQuiz TabletQuiz.
     * @param attempt Attempt.
     * @returns Whether it's nearly over or over.
     */
    isAttemptTimeNearlyOver(TabletQuiz: AddonModTabletQuizQuizWSData, attempt: AddonModTabletQuizAttemptWSData): boolean {
        if (attempt.state !== ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.IN_PROGRESS) {
            // Attempt not in progress, return true.
            return true;
        }

        const dueDate = this.getAttemptDueDate(TabletQuiz, attempt);
        const autoSavePeriod = TabletQuiz.autosaveperiod || 0;

        if (dueDate > 0 && Date.now() + autoSavePeriod >= dueDate) {
            return true;
        }

        return false;
    }

    /**
     * Check if last attempt is offline and unfinished.
     *
     * @param TabletQuiz TabletQuiz data.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined, user current site's user.
     * @returns Promise resolved with boolean: true if last offline attempt is unfinished, false otherwise.
     */
    async isLastAttemptOfflineUnfinished(TabletQuiz: AddonModTabletQuizQuizWSData, siteId?: string, userId?: number): Promise<boolean> {
        try {
            const attempts = await ADDON_MOD_TABLETQUIZ_OFFLINE.getQuizAttempts(TabletQuiz.id, siteId, userId);

            const last = attempts.pop();

            return !!last && !last.finished;
        } catch {
            return false;
        }
    }

    /**
     * Check if a TabletQuiz navigation is sequential.
     *
     * @param TabletQuiz TabletQuiz.
     * @returns Whether navigation is sequential.
     */
    isNavigationSequential(TabletQuiz: AddonModTabletQuizQuizWSData): boolean {
        return TabletQuiz.navmethod === ADDON_MOD_TABLETQUIZ_NAV_METHODS.SEQ;
    }

    /**
     * Check if a question is blocked.
     *
     * @param question Question.
     * @returns Whether it's blocked.
     */
    isQuestionBlocked(question: CoreQuestionQuestionParsed): boolean {
        const element = convertTextToHTMLElement(question.html);

        return !!element.querySelector('.mod_tabletquiz-blocked_question_warning');
    }

    /**
     * Check if a question is unanswered.
     *
     * @param question Question.
     * @returns Whether it's unanswered.
     */
    isQuestionUnanswered(question: CoreQuestionQuestionParsed): boolean {
        if (!question.stateclass) {
            return false;
        }

        return QUESTION_TODO_STATE_CLASSES.some(stateClass => stateClass === question.stateclass)
            || QUESTION_INVALID_STATE_CLASSES.some(stateClass => stateClass === question.stateclass);
    }

    /**
     * Check if a TabletQuiz is enabled to be used in offline.
     *
     * @param TabletQuiz TabletQuiz.
     * @returns Whether offline is enabled.
     */
    isQuizOffline(TabletQuiz: AddonModTabletQuizQuizWSData): boolean {
        // Don't allow downloading the TabletQuiz if offline is disabled to prevent wasting a lot of data when opening it.
        return !!TabletQuiz.allowofflineattempts
            && !this.isNavigationSequential(TabletQuiz)
            && !CoreSites.getCurrentSite()?.isOfflineDisabled();
    }

    /**
     * Report an attempt as being viewed. It did not store logs offline because order of the log is important.
     *
     * @param attemptId Attempt ID.
     * @param page Page number.
     * @param preflightData Preflight required data (like password).
     * @param offline Whether attempt is offline.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when the WS call is successful.
     */
    async logViewAttempt(
        attemptId: number,
        page: number = 0,
        preflightData: Record<string, string> = {},
        offline?: boolean,
        siteId?: string,
    ): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        const params: AddonModTabletQuizViewAttemptWSParams = {
            attemptid: attemptId,
            page: page,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
            ),
        };
        const promises: Promise<unknown>[] = [];

        promises.push(site.write('mod_tabletquiz_view_attempt', params));
        if (offline) {
            promises.push(ADDON_MOD_TABLETQUIZ_OFFLINE.setAttemptCurrentPage(attemptId, page, site.getId()));
        }

        await Promise.all(promises);
    }

    /**
     * Report an attempt's review as being viewed.
     *
     * @param attemptId Attempt ID.
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when the WS call is successful.
     */
    logViewAttemptReview(attemptId: number, quizId: number, siteId?: string): Promise<void> {
        const params: AddonModTabletQuizViewAttemptReviewWSParams = {
            attemptid: attemptId,
        };

        return CoreCourseLogHelper.log(
            'mod_tabletquiz_view_attempt_review',
            params,
            ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            quizId,
            siteId,
        );
    }

    /**
     * Report an attempt's summary as being viewed.
     *
     * @param attemptId Attempt ID.
     * @param preflightData Preflight required data (like password).
     * @param quizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when the WS call is successful.
     */
    logViewAttemptSummary(
        attemptId: number,
        preflightData: Record<string, string>,
        quizId: number,
        siteId?: string,
    ): Promise<void> {
        const params: AddonModTabletQuizViewAttemptSummaryWSParams = {
            attemptid: attemptId,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
            ),
        };

        return CoreCourseLogHelper.log(
            'mod_tabletquiz_view_attempt_summary',
            params,
            ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            quizId,
            siteId,
        );
    }

    /**
     * Report a TabletQuiz as being viewed.
     *
     * @param id Module ID.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when the WS call is successful.
     */
    logViewQuiz(id: number, siteId?: string): Promise<void> {
        const params: AddonModTabletQuizViewQuizWSParams = {
            quizid: id,
        };

        return CoreCourseLogHelper.log(
            'mod_tabletquiz_view_quiz',
            params,
            ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            id,
            siteId,
        );
    }

    /**
     * Process an attempt, saving its data.
     *
     * @param TabletQuiz TabletQuiz.
     * @param attempt Attempt.
     * @param data Data to save.
     * @param preflightData Preflight required data (like password).
     * @param finish Whether to finish the TabletQuiz.
     * @param timeUp Whether the TabletQuiz time is up, false otherwise.
     * @param offline Whether the attempt is offline.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved in success, rejected otherwise.
     */
    async processAttempt(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        attempt: AddonModTabletQuizAttemptWSData,
        data: CoreQuestionsAnswers,
        preflightData: Record<string, string>,
        finish?: boolean,
        timeUp?: boolean,
        offline?: boolean,
        siteId?: string,
    ): Promise<void> {
        if (offline) {
            return this.processAttemptOffline(TabletQuiz, attempt, data, preflightData, finish, siteId);
        }

        await this.processAttemptOnline(attempt.id, data, preflightData, finish, timeUp, siteId);
    }

    /**
     * Process an online attempt, saving its data.
     *
     * @param attemptId Attempt ID.
     * @param data Data to save.
     * @param preflightData Preflight required data (like password).
     * @param finish Whether to finish the TabletQuiz.
     * @param timeUp Whether the TabletQuiz time is up, false otherwise.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved in success, rejected otherwise.
     */
    protected async processAttemptOnline(
        attemptId: number,
        data: CoreQuestionsAnswers,
        preflightData: Record<string, string>,
        finish?: boolean,
        timeUp?: boolean,
        siteId?: string,
    ): Promise<string> {
        const site = await CoreSites.getSite(siteId);

        const params: AddonModTabletQuizProcessAttemptWSParams = {
            attemptid: attemptId,
            data: CoreObject.toArrayOfObjects(data, 'name', 'value'),
            finishattempt: !!finish,
            timeup: !!timeUp,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
            ),
        };

        const response = await site.write<AddonModTabletQuizProcessAttemptWSResponse>('mod_tabletquiz_process_attempt', params);

        if (response.warnings?.length) {
            // Reject with the first warning.
            throw new CoreWSError(response.warnings[0]);
        }

        return response.state;
    }

    /**
     * Process an offline attempt, saving its data.
     *
     * @param TabletQuiz TabletQuiz.
     * @param attempt Attempt.
     * @param data Data to save.
     * @param preflightData Preflight required data (like password).
     * @param finish Whether to finish the TabletQuiz.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved in success, rejected otherwise.
     */
    protected async processAttemptOffline(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        attempt: AddonModTabletQuizAttemptWSData,
        data: CoreQuestionsAnswers,
        preflightData: Record<string, string>,
        finish?: boolean,
        siteId?: string,
    ): Promise<void> {

        // Get attempt summary to have the list of questions.
        const questionsArray = await this.getAttemptSummary(attempt.id, preflightData, {
            cmId: TabletQuiz.coursemodule,
            loadLocal: true,
            readingStrategy: CoreSitesReadingStrategy.PREFER_CACHE,
            siteId,
        });

        // Convert the question array to an object.
        const questions = CoreArray.toObject(questionsArray, 'slot');

        return ADDON_MOD_TABLETQUIZ_OFFLINE.processAttempt(TabletQuiz, attempt, questions, data, finish, siteId);
    }

    /**
     * Check if it's a graded TabletQuiz. Based on Moodle's quiz_has_grades.
     *
     * @param TabletQuiz TabletQuiz.
     * @returns Whether TabletQuiz is graded.
     */
    quizHasGrades(TabletQuiz: AddonModTabletQuizQuizWSData): boolean {
        return (TabletQuiz.grade ?? 0) >= 0.000005 && (TabletQuiz.sumgrades ?? 0) >= 0.000005;
    }

    /**
     * Convert the raw grade into a grade out of the maximum grade for this TabletQuiz.
     * Based on Moodle's quiz_rescale_grade.
     *
     * @param rawGrade The unadjusted grade, for example attempt.sumgrades.
     * @param TabletQuiz TabletQuiz.
     * @param format True to format the results for display, 'question' to format a question grade
     *               (different number of decimal places), false to not format it.
     * @returns Grade to display.
     */
    rescaleGrade(
        rawGrade: string | number | undefined | null,
        TabletQuiz: AddonModTabletQuizQuizWSData,
        format: boolean | string = true,
    ): string | undefined {
        let grade: number | undefined;

        const rawGradeNum = typeof rawGrade === 'string' ? parseFloat(rawGrade) : rawGrade;
        if (rawGradeNum !== undefined && rawGradeNum !== null && !isNaN(rawGradeNum)) {
            if (TabletQuiz.sumgrades && TabletQuiz.sumgrades >= 0.000005) {
                grade = rawGradeNum * (TabletQuiz.grade ?? 0) / TabletQuiz.sumgrades;
            } else {
                grade = 0;
            }
        }

        if (grade === null || grade === undefined) {
            return;
        }

        if (format === 'question') {
            return this.formatGrade(grade, this.getGradeDecimals(TabletQuiz));
        } else if (format) {
            return this.formatGrade(grade, TabletQuiz.decimalpoints ?? 1);
        }

        return String(grade);
    }

    /**
     * Save an attempt data.
     *
     * @param TabletQuiz TabletQuiz.
     * @param attempt Attempt.
     * @param data Data to save.
     * @param preflightData Preflight required data (like password).
     * @param offline Whether attempt is offline.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved in success, rejected otherwise.
     */
    async saveAttempt(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        attempt: AddonModTabletQuizAttemptWSData,
        data: CoreQuestionsAnswers,
        preflightData: Record<string, string>,
        offline?: boolean,
        siteId?: string,
    ): Promise<void> {
        try {
            if (offline) {
                return await this.processAttemptOffline(TabletQuiz, attempt, data, preflightData, false, siteId);
            }

            await this.saveAttemptOnline(attempt.id, data, preflightData, siteId);
        } catch (error) {
            this.logger.error(error);

            throw error;
        }
    }

    /**
     * Save an attempt data.
     *
     * @param attemptId Attempt ID.
     * @param data Data to save.
     * @param preflightData Preflight required data (like password).
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved in success, rejected otherwise.
     */
    protected async saveAttemptOnline(
        attemptId: number,
        data: CoreQuestionsAnswers,
        preflightData: Record<string, string>,
        siteId?: string,
    ): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        const params: AddonModTabletQuizSaveAttemptWSParams = {
            attemptid: attemptId,
            data: CoreObject.toArrayOfObjects(data, 'name', 'value'),
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
            ),
        };

        const response = await site.write<CoreStatusWithWarningsWSResponse>('mod_tabletquiz_save_attempt', params);

        if (response.warnings?.length) {
            // Reject with the first warning.
            throw new CoreWSError(response.warnings[0]);
        } else if (!response.status) {
            // It shouldn't happen that status is false and no warnings were returned.
            throw new CoreError('Cannot save data.');
        }
    }

    /**
     * Check if time left should be shown.
     *
     * @param rules List of active rules names.
     * @param attempt Attempt.
     * @param endTime The attempt end time (in seconds).
     * @returns Whether time left should be displayed.
     */
    shouldShowTimeLeft(rules: string[], attempt: AddonModTabletQuizAttemptWSData, endTime: number): boolean {
        const timeNow = CoreTime.timestamp();

        if (attempt.state !== ADDON_MOD_TABLETQUIZ_ATTEMPT_STATES.IN_PROGRESS) {
            return false;
        }

        return ADDON_MOD_TABLETQUIZ_ACCESS_RULE_DELEGATE.shouldShowTimeLeft(rules, attempt, endTime, timeNow);
    }

    /**
     * Start an attempt.
     *
     * @param quizId TabletQuiz ID.
     * @param preflightData Preflight required data (like password).
     * @param forceNew Whether to force a new attempt or not.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with the attempt data.
     */
    async startAttempt(
        quizId: number,
        preflightData: Record<string, string>,
        forceNew?: boolean,
        siteId?: string,
    ): Promise<AddonModTabletQuizAttemptWSData> {
        const site = await CoreSites.getSite(siteId);

        const params: AddonModTabletQuizStartAttemptWSParams = {
            quizid: quizId,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
            ),
            forcenew: !!forceNew,
        };

        const response = await site.write<AddonModTabletQuizStartAttemptWSResponse>('mod_tabletquiz_start_attempt', params);

        if (response.warnings?.length) {
            // Reject with the first warning.
            throw new CoreWSError(response.warnings[0]);
        }

        return response.attempt;
    }

}

export const AddonModTabletQuiz = makeSingleton(AddonModTabletQuizProvider);

/**
 * Common options with user ID.
 */
export type AddonModTabletQuizUserOptions = CoreCourseCommonModWSOptions & {
    userId?: number; // User ID. If not defined use site's current user.
};

/**
 * Options to pass to getAllQuestionsData.
 */
export type AddonModTabletQuizAllQuestionsDataOptions = CoreCourseCommonModWSOptions & {
    pages?: number[]; // List of pages to get. If not defined, all pages.
};

/**
 * Options to pass to getAttemptReview.
 */
export type AddonModTabletQuizGetAttemptReviewOptions = CoreCourseCommonModWSOptions & {
    page?: number; // List of pages to get. If not defined, all pages.
};

/**
 * Options to pass to getAttemptSummary.
 */
export type AddonModTabletQuizGetAttemptSummaryOptions = CoreCourseCommonModWSOptions & {
    loadLocal?: boolean; // Whether it should load local state for each question.
};

/**
 * Options to pass to getUserAttempts.
 */
export type AddonModTabletQuizGetUserAttemptsOptions = CoreCourseCommonModWSOptions & {
    status?: string; // Status of the attempts to get. By default, 'all'.
    includePreviews?: boolean; // Whether to include previews. Defaults to true.
    userId?: number; // User ID. If not defined use site's current user.
};

/**
 * Preflight data in the format accepted by the WebServices.
 */
type AddonModTabletQuizPreflightDataWSParam = {
    name: string; // Data name.
    value: string; // Data value.
};

/**
 * Params of mod_tabletquiz_get_attempt_access_information WS.
 */
export type AddonModTabletQuizGetAttemptAccessInformationWSParams = {
    quizid: number; // TabletQuiz instance id.
    attemptid?: number; // Attempt id, 0 for the user last attempt if exists.
};

/**
 * Data returned by mod_tabletquiz_get_attempt_access_information WS.
 */
export type AddonModTabletQuizGetAttemptAccessInformationWSResponse = {
    endtime?: number; // When the attempt must be submitted (determined by rules).
    isfinished: boolean; // Whether there is no way the user will ever be allowed to attempt.
    ispreflightcheckrequired?: boolean; // Whether a check is required before the user starts/continues his attempt.
    preventnewattemptreasons: string[]; // List of reasons.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tabletquiz_get_attempt_data WS.
 */
export type AddonModTabletQuizGetAttemptDataWSParams = {
    attemptid: number; // Attempt id.
    page: number; // Page number.
    preflightdata?: AddonModTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Data returned by mod_tabletquiz_get_attempt_data WS.
 */
export type AddonModTabletQuizGetAttemptDataWSResponse = {
    attempt: AddonModTabletQuizAttemptWSData;
    messages: string[]; // Access messages, will only be returned for users with mod/TabletQuiz:preview capability.
    nextpage: number; // Next page number.
    questions: CoreQuestionQuestionWSData[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * Attempt data returned by several WebServices.
 */
export type AddonModTabletQuizAttemptWSData = {
    id: number; // Attempt id.
    TabletQuiz?: number; // Foreign key reference to the TabletQuiz that was attempted.
    userid?: number; // Foreign key reference to the user whose attempt this is.
    attempt?: number; // Sequentially numbers this students attempts at this TabletQuiz.
    uniqueid?: number; // Foreign key reference to the question_usage that holds the details of the the question_attempts.
    layout?: string; // Attempt layout.
    currentpage?: number; // Attempt current page.
    preview?: number; // Whether is a preview attempt or not.
    state?: string; // The current state of the attempts. 'inprogress', 'overdue', 'finished' or 'abandoned'.
    timestart?: number; // Time when the attempt was started.
    timefinish?: number; // Time when the attempt was submitted. 0 if the attempt has not been submitted yet.
    timemodified?: number; // Last modified time.
    timemodifiedoffline?: number; // Last modified time via webservices.
    timecheckstate?: number; // Next time TabletQuiz cron should check attempt for state changes. NULL means never check.
    sumgrades?: SafeNumber | null; // Total marks for this attempt.
    gradeitemmarks?: { // @since 4.4. If the TabletQuiz has additional grades set up, the mark for each grade for this attempt.
        name: string; // The name of this grade item.
        grade: number; // The grade this attempt earned for this item.
        maxgrade: number; // The total this grade is out of.
    }[];
};

/**
 * Get attempt data response with parsed questions.
 */
export type AddonModTabletQuizGetAttemptDataResponse = Omit<AddonModTabletQuizGetAttemptDataWSResponse, 'questions'> & {
    questions: CoreQuestionQuestionParsed[];
};

/**
 * Params of mod_tabletquiz_get_attempt_review WS.
 */
export type AddonModTabletQuizGetAttemptReviewWSParams = {
    attemptid: number; // Attempt id.
    page?: number; // Page number, empty for all the questions in all the pages.
};

/**
 * Data returned by mod_tabletquiz_get_attempt_review WS.
 */
export type AddonModTabletQuizGetAttemptReviewWSResponse = {
    grade: string; // Grade for the TabletQuiz (or empty or "notyetgraded").
    attempt: AddonModTabletQuizAttemptWSData;
    additionaldata: AddonModTabletQuizWSAdditionalData[];
    questions: CoreQuestionQuestionWSData[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * Additional data returned by mod_tabletquiz_get_attempt_review WS.
 */
export type AddonModTabletQuizWSAdditionalData = {
    id: string; // Id of the data.
    title: string; // Data title.
    content: string; // Data content.
};

/**
 * Get attempt review response with parsed questions.
 */
export type AddonModTabletQuizGetAttemptReviewResponse = Omit<AddonModTabletQuizGetAttemptReviewWSResponse, 'questions'> & {
    questions: CoreQuestionQuestionParsed[];
};

/**
 * Params of mod_tabletquiz_get_attempt_summary WS.
 */
export type AddonModTabletQuizGetAttemptSummaryWSParams = {
    attemptid: number; // Attempt id.
    preflightdata?: AddonModTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Data returned by mod_tabletquiz_get_attempt_summary WS.
 */
export type AddonModTabletQuizGetAttemptSummaryWSResponse = {
    questions: CoreQuestionQuestionWSData[];
    totalunanswered?: number; // @since 4.4. Total unanswered questions.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tabletquiz_get_combined_review_options WS.
 */
export type AddonModTabletQuizGetCombinedReviewOptionsWSParams = {
    quizid: number; // TabletQuiz instance id.
    userid?: number; // User id (empty for current user).
};

/**
 * Data returned by mod_tabletquiz_get_combined_review_options WS.
 */
export type AddonModTabletQuizGetCombinedReviewOptionsWSResponse = {
    someoptions: AddonModTabletQuizWSReviewOption[];
    alloptions: AddonModTabletQuizWSReviewOption[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * Option data returned by mod_tabletquiz_get_combined_review_options.
 */
export type AddonModTabletQuizWSReviewOption = {
    name: string; // Option name.
    value: number; // Option value.
};

/**
 * Data returned by mod_tabletquiz_get_combined_review_options WS, formatted to convert the options to objects.
 */
export type AddonModTabletQuizCombinedReviewOptions = Omit<AddonModTabletQuizGetCombinedReviewOptionsWSResponse, 'alloptions'|'someoptions'> & {
    someoptions: Record<string, number>;
    alloptions: Record<string, number>;
};

/**
 * Params of mod_tabletquiz_get_quiz_feedback_for_grade WS.
 */
export type AddonModTabletQuizGetQuizFeedbackForGradeWSParams = {
    quizid: number; // TabletQuiz instance id.
    grade: number; // The grade to check.
};

/**
 * Data returned by mod_tabletquiz_get_quiz_feedback_for_grade WS.
 */
export type AddonModTabletQuizGetQuizFeedbackForGradeWSResponse = {
    feedbacktext: string; // The comment that corresponds to this grade (empty for none).
    feedbacktextformat?: CoreTextFormat; // Feedbacktext format (1 = HTML, 0 = MOODLE, 2 = PLAIN or 4 = MARKDOWN).
    feedbackinlinefiles?: CoreWSExternalFile[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tabletquiz_get_quizzes_by_courses WS.
 */
export type AddonModTabletQuizGetQuizzesByCoursesWSParams = {
    courseids?: number[]; // Array of course ids.
};

/**
 * Data returned by mod_tabletquiz_get_quizzes_by_courses WS.
 */
export type AddonModTabletQuizGetQuizzesByCoursesWSResponse = {
    quizzes: AddonModTabletQuizQuizWSData[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * TabletQuiz data returned by mod_tabletquiz_get_quizzes_by_courses WS.
 */
export type AddonModTabletQuizQuizWSData = CoreCourseModuleStandardElements & {
    timeopen?: number; // The time when this TabletQuiz opens. (0 = no restriction.).
    timeclose?: number; // The time when this TabletQuiz closes. (0 = no restriction.).
    timelimit?: number; // The time limit for TabletQuiz attempts, in seconds.
    overduehandling?: string; // The method used to handle overdue attempts. 'autosubmit', 'graceperiod' or 'autoabandon'.
    graceperiod?: number; // The amount of time (in seconds) after time limit during which attempts can still be submitted.
    preferredbehaviour?: string; // The behaviour to ask questions to use.
    canredoquestions?: number; // Allows students to redo any completed question within a TabletQuiz attempt.
    attempts?: number; // The maximum number of attempts a student is allowed.
    attemptonlast?: number; // Whether subsequent attempts start from the answer to the previous attempt (1) or start blank (0).
    grademethod?: number; // One of the values QUIZ_GRADEHIGHEST, QUIZ_GRADEAVERAGE, QUIZ_ATTEMPTFIRST or QUIZ_ATTEMPTLAST.
    decimalpoints?: number; // Number of decimal points to use when displaying grades.
    questiondecimalpoints?: number; // Number of decimal points to use when displaying question grades.
    reviewattempt?: number; // Whether users are allowed to review their TabletQuiz attempts at various times.
    reviewcorrectness?: number; // Whether users are allowed to review their TabletQuiz attempts at various times.
    reviewmaxmarks?: number; // @since 4.3. Whether users are allowed to review their TabletQuiz attempts at various times.
    reviewmarks?: number; // Whether users are allowed to review their TabletQuiz attempts at various times.
    reviewspecificfeedback?: number; // Whether users are allowed to review their TabletQuiz attempts at various times.
    reviewgeneralfeedback?: number; // Whether users are allowed to review their TabletQuiz attempts at various times.
    reviewrightanswer?: number; // Whether users are allowed to review their TabletQuiz attempts at various times.
    reviewoverallfeedback?: number; // Whether users are allowed to review their TabletQuiz attempts at various times.
    questionsperpage?: number; // How often to insert a page break when editing the TabletQuiz, or when shuffling the question order.
    navmethod?: ADDON_MOD_TABLETQUIZ_NAV_METHODS; // Any constraints on how the user is allowed to navigate around the TabletQuiz.
    shuffleanswers?: number; // Whether the parts of the question should be shuffled, in those question types that support it.
    sumgrades?: number | null; // The total of all the question instance maxmarks.
    grade?: number; // The total that the TabletQuiz overall grade is scaled to be out of.
    timecreated?: number; // The time when the TabletQuiz was added to the course.
    timemodified?: number; // Last modified time.
    password?: string; // A password that the student must enter before starting or continuing a TabletQuiz attempt.
    subnet?: string; // Used to restrict the IP addresses from which this TabletQuiz can be attempted.
    browsersecurity?: string; // Restriciton on the browser the student must use. E.g. 'securewindow'.
    delay1?: number; // Delay that must be left between the first and second attempt, in seconds.
    delay2?: number; // Delay that must be left between the second and subsequent attempt, in seconds.
    showuserpicture?: number; // Option to show the user's picture during the attempt and on the review page.
    showblocks?: number; // Whether blocks should be shown on the attempt.php and review.php pages.
    completionattemptsexhausted?: number; // Mark TabletQuiz complete when the student has exhausted the maximum number of attempts.
    completionpass?: number; // Whether to require passing grade.
    allowofflineattempts?: number; // Whether to allow the TabletQuiz to be attempted offline in the mobile app.
    autosaveperiod?: number; // Auto-save delay.
    hasfeedback?: number; // Whether the TabletQuiz has any non-blank feedback text.
    hasquestions?: number; // Whether the TabletQuiz has questions.
};

/**
 * Params of mod_tabletquiz_get_quiz_access_information WS.
 */
export type AddonModTabletQuizGetQuizAccessInformationWSParams = {
    quizid: number; // TabletQuiz instance id.
};

/**
 * Data returned by mod_tabletquiz_get_quiz_access_information WS.
 */
export type AddonModTabletQuizGetQuizAccessInformationWSResponse = {
    canattempt: boolean; // Whether the user can do the TabletQuiz or not.
    canmanage: boolean; // Whether the user can edit the TabletQuiz settings or not.
    canpreview: boolean; // Whether the user can preview the TabletQuiz or not.
    canreviewmyattempts: boolean; // Whether the users can review their previous attempts or not.
    canviewreports: boolean; // Whether the user can view the TabletQuiz reports or not.
    accessrules: string[]; // List of rules.
    activerulenames: string[]; // List of active rules.
    preventaccessreasons: string[]; // List of reasons.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tabletquiz_get_quiz_required_qtypes WS.
 */
export type AddonModTabletQuizGetQuizRequiredQtypesWSParams = {
    quizid: number; // TabletQuiz instance id.
};

/**
 * Data returned by mod_tabletquiz_get_quiz_required_qtypes WS.
 */
export type AddonModTabletQuizGetQuizRequiredQtypesWSResponse = {
    questiontypes: string[]; // List of question types used in the TabletQuiz.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tabletquiz_get_user_attempts WS.
 */
export type AddonModTabletQuizGetUserAttemptsWSParams = {
    quizid: number; // TabletQuiz instance id.
    userid?: number; // User id, empty for current user.
    status?: string; // TabletQuiz status: all, finished or unfinished.
    includepreviews?: boolean; // Whether to include previews or not.
};

/**
 * Data returned by mod_tabletquiz_get_user_attempts WS.
 */
export type AddonModTabletQuizGetUserAttemptsWSResponse = {
    attempts: AddonModTabletQuizAttemptWSData[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tabletquiz_get_user_best_grade WS.
 */
export type AddonModTabletQuizGetUserBestGradeWSParams = {
    quizid: number; // TabletQuiz instance id.
    userid?: number; // User id.
};

/**
 * Data returned by mod_tabletquiz_get_user_best_grade WS.
 */
export type AddonModTabletQuizGetUserBestGradeWSResponse = {
    hasgrade: boolean; // Whether the user has a grade on the given TabletQuiz.
    grade?: SafeNumber; // The grade (only if the user has a grade).
    gradetopass?: number; // @since 3.11. The grade to pass the TabletQuiz (only if set).
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tabletquiz_view_attempt WS.
 */
export type AddonModTabletQuizViewAttemptWSParams = {
    attemptid: number; // Attempt id.
    page: number; // Page number.
    preflightdata?: AddonModTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Params of mod_tabletquiz_process_attempt WS.
 */
export type AddonModTabletQuizProcessAttemptWSParams = {
    attemptid: number; // Attempt id.
    data?: { // The data to be saved.
        name: string; // Data name.
        value: string; // Data value.
    }[];
    finishattempt?: boolean; // Whether to finish or not the attempt.
    timeup?: boolean; // Whether the WS was called by a timer when the time is up.
    preflightdata?: AddonModTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Data returned by mod_tabletquiz_process_attempt WS.
 */
export type AddonModTabletQuizProcessAttemptWSResponse = {
    state: string; // The new attempt state: inprogress, finished, overdue, abandoned.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tabletquiz_save_attempt WS.
 */
export type AddonModTabletQuizSaveAttemptWSParams = {
    attemptid: number; // Attempt id.
    data: { // The data to be saved.
        name: string; // Data name.
        value: string; // Data value.
    }[];
    preflightdata?: AddonModTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Params of mod_tabletquiz_start_attempt WS.
 */
export type AddonModTabletQuizStartAttemptWSParams = {
    quizid: number; // TabletQuiz instance id.
    preflightdata?: AddonModTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
    forcenew?: boolean; // Whether to force a new attempt or not.
};

/**
 * Data returned by mod_tabletquiz_start_attempt WS.
 */
export type AddonModTabletQuizStartAttemptWSResponse = {
    attempt: AddonModTabletQuizAttemptWSData;
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tabletquiz_view_attempt_review WS.
 */
export type AddonModTabletQuizViewAttemptReviewWSParams = {
    attemptid: number; // Attempt id.
};

/**
 * Params of mod_tabletquiz_view_attempt_summary WS.
 */
export type AddonModTabletQuizViewAttemptSummaryWSParams = {
    attemptid: number; // Attempt id.
    preflightdata?: AddonModTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Params of mod_tabletquiz_view_quiz WS.
 */
export type AddonModTabletQuizViewQuizWSParams = {
    quizid: number; // TabletQuiz instance id.
};

/**
 * Data passed to ADDON_MOD_TABLETQUIZ_ATTEMPT_FINISHED_EVENT event.
 */
export type AddonModTabletQuizAttemptFinishedData = {
    quizId: number;
    attemptId: number;
    synced: boolean;
};

/**
 * TabletQuiz display option value.
 */
export type AddonModTabletQuizDisplayOptionValue = QuestionDisplayOptionsMarks | QuestionDisplayOptionsValues | boolean;

/**
 * TabletQuiz display options, it can be used to determine which options to display.
 */
export type AddonModTabletQuizDisplayOptions = {
    attempt: boolean;
    correctness: QuestionDisplayOptionsValues;
    marks: QuestionDisplayOptionsMarks | QuestionDisplayOptionsValues;
    feedback: QuestionDisplayOptionsValues;
    generalfeedback: QuestionDisplayOptionsValues;
    rightanswer: QuestionDisplayOptionsValues;
    overallfeedback: QuestionDisplayOptionsValues;
    numpartscorrect: QuestionDisplayOptionsValues;
    manualcomment: QuestionDisplayOptionsValues;
    markdp: number;
};




