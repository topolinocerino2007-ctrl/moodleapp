// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
import { AddonModTabletTabletQuizAccessRuleDelegate } from './access-rules-delegate';
import { AddonModTabletTabletQuizOffline, AddonModTabletTabletQuizQuestionsWithAnswers } from './tabletquiz-offline';
import { CoreSiteWSPreSets } from '@classes/sites/authenticated-site';
import {
    QUESTION_INVALID_STATE_CLASSES,
    QUESTION_TODO_STATE_CLASSES,
    QuestionDisplayOptionsMarks,
    QuestionDisplayOptionsValues,
} from '@features/question/constants';
import {
    ADDON_MOD_TABLETQUIZ_ATTEMPT_FINISHED_EVENT,
    AddonModTabletTabletQuizAttemptStates,
    ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
    AddonModTabletTabletQuizGradeMethods,
    AddonModTabletTabletQuizDisplayOptionsAttemptStates,
    ADDON_MOD_TABLETQUIZ_IMMEDIATELY_AFTER_PERIOD,
    AddonModTabletTabletQuizNavMethods,
} from '../constants';
import { CoreIonicColorNames } from '@singletons/colors';
import { CoreCacheUpdateFrequency } from '@/core/constants';
import { CoreObject } from '@singletons/object';
import { CoreArray } from '@singletons/array';
import { CoreTextFormat } from '@singletons/text';
import { CoreCourseModuleHelper, CoreCourseModuleStandardElements } from '@features/course/services/course-module-helper';

declare module '@singletons/events' {

    /**
     * Augment CoreEventsData interface with events specific to this service.
     *
     * @see https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation
     */
    export interface CoreEventsData {
        [ADDON_MOD_TABLETQUIZ_ATTEMPT_FINISHED_EVENT]: AddonModTabletTabletQuizAttemptFinishedData;
    }

}

/**
 * Service that provides some features for tabletquiz.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletTabletQuizProvider {

    protected static readonly ROOT_CACHE_KEY = 'mmaModTabletTabletQuiz:';

    protected logger: CoreLogger;

    constructor() {
        this.logger = CoreLogger.getInstance('AddonModTabletTabletQuizProvider');
    }

    /**
     * Formats a grade to be displayed.
     *
     * @param grade Grade.
     * @param decimals Decimals to use.
     * @returns Grade to display.
     */
    formatGrade(grade?: number | null, decimals?: number): string {
        if (grade === undefined || grade === -1 || grade === null || isNaN(grade)) {
            return Translate.instant('addon.mod_tablettabletquiz.notyetgraded');
        }

        return CoreUtils.formatFloat(grade.toFixed(decimals ?? 2));
    }

    /**
     * Get attempt questions. Returns all of them or just the ones in certain pages.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @param preflightData Preflight required data (like password).
     * @param options Other options.
     * @returns Promise resolved with the questions.
     */
    async getAllQuestionsData(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData,
        preflightData: Record<string, string>,
        options: AddonModTabletTabletQuizAllQuestionsDataOptions = {},
    ): Promise<Record<number, CoreQuestionQuestionParsed>> {

        const questions: Record<number, CoreQuestionQuestionParsed> = {};
        const isSequential = this.isNavigationSequential(tabletquiz);
        const pages = options.pages || this.getPagesFromLayout(attempt.layout);

        await Promise.all(pages.map(async (page) => {
            if (isSequential && page < (attempt.currentpage || 0)) {
                // Sequential tabletquiz, cannot get pages before the current one.
                return;
            }

            // Get the questions in the page.
            const data = await this.getAttemptData(attempt.id, page, preflightData, options);

            // Add the questions to the result object.
            data.questions.forEach((question) => {
                questions[question.slot] = question;
            });
        }));

        return questions;
    }

    /**
     * Get cache key for get attempt access information WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param attemptId Attempt ID.
     * @returns Cache key.
     */
    protected getAttemptAccessInformationCacheKey(tabletquizId: number, attemptId: number): string {
        return `${this.getAttemptAccessInformationCommonCacheKey(tabletquizId)}:${attemptId}`;
    }

    /**
     * Get common cache key for get attempt access information WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getAttemptAccessInformationCommonCacheKey(tabletquizId: number): string {
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}attemptAccessInformation:${tabletquizId}`;
    }

    /**
     * Get access information for an attempt.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param attemptId Attempt ID. 0 for user's last attempt.
     * @param options Other options.
     * @returns Promise resolved with the access information.
     */
    async getAttemptAccessInformation(
        tabletquizId: number,
        attemptId: number,
        options: CoreCourseCommonModWSOptions = {},
    ): Promise<AddonModTabletTabletQuizGetAttemptAccessInformationWSResponse> {

        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletTabletQuizGetAttemptAccessInformationWSParams = {
            tabletquizid: tabletquizId,
            attemptid: attemptId,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getAttemptAccessInformationCacheKey(tabletquizId, attemptId),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        return site.read('mod_tablettabletquiz_get_attempt_access_information', params, preSets);
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
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}attemptData:${attemptId}`;
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
    ): Promise<AddonModTabletTabletQuizGetAttemptDataResponse> {

        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletTabletQuizGetAttemptDataWSParams = {
            attemptid: attemptId,
            page: page,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletTabletQuizPreflightDataWSParam>(
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

        const result = await site.read<AddonModTabletTabletQuizGetAttemptDataWSResponse>('mod_tablettabletquiz_get_attempt_data', params, preSets);

        result.questions = CoreQuestion.parseQuestions(result.questions);

        return result;
    }

    /**
     * Get an attempt's due date.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @returns Attempt's due date, 0 if no due date or invalid data.
     */
    getAttemptDueDate(tabletquiz: AddonModTabletTabletQuizTabletQuizWSData, attempt: AddonModTabletTabletQuizAttemptWSData): number {
        const deadlines: number[] = [];

        if (tabletquiz.timelimit && attempt.timestart) {
            deadlines.push(attempt.timestart + tabletquiz.timelimit);
        }
        if (tabletquiz.timeclose) {
            deadlines.push(tabletquiz.timeclose);
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
            case AddonModTabletTabletQuizAttemptStates.IN_PROGRESS:
                return dueDate * 1000;

            case AddonModTabletTabletQuizAttemptStates.OVERDUE:
                return (dueDate + (tabletquiz.graceperiod ?? 0)) * 1000;

            default:
                this.logger.warn(`Unexpected state when getting due date: ${attempt.state}`);

                return 0;
        }
    }

    /**
     * Get an attempt's warning because of due date.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @returns Attempt's warning, undefined if no due date.
     */
    getAttemptDueDateWarning(tabletquiz: AddonModTabletTabletQuizTabletQuizWSData, attempt: AddonModTabletTabletQuizAttemptWSData): string | undefined {
        const dueDate = this.getAttemptDueDate(tabletquiz, attempt);

        if (attempt.state === AddonModTabletTabletQuizAttemptStates.OVERDUE) {
            return Translate.instant(
                'addon.mod_tablettabletquiz.overduemustbesubmittedby',
                { $a: CoreTime.userDate(dueDate) },
            );
        } else if (dueDate) {
            return Translate.instant('addon.mod_tablettabletquiz.mustbesubmittedby', { $a: CoreTime.userDate(dueDate) });
        }
    }

    /**
     * Get the display option value related to the attempt state.
     * Equivalent to LMS tabletquiz_attempt_state.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @returns Display option value.
     */
    getAttemptStateDisplayOption(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData,
    ): AddonModTabletTabletQuizDisplayOptionsAttemptStates {
        if (attempt.state === AddonModTabletTabletQuizAttemptStates.IN_PROGRESS) {
            return AddonModTabletTabletQuizDisplayOptionsAttemptStates.DURING;
        } else if (tabletquiz.timeclose && Date.now() >= tabletquiz.timeclose * 1000) {
            return AddonModTabletTabletQuizDisplayOptionsAttemptStates.AFTER_CLOSE;
        } else if (Date.now() < ((attempt.timefinish ?? 0) + ADDON_MOD_TABLETQUIZ_IMMEDIATELY_AFTER_PERIOD) * 1000) {
            return AddonModTabletTabletQuizDisplayOptionsAttemptStates.IMMEDIATELY_AFTER;
        }

        return AddonModTabletTabletQuizDisplayOptionsAttemptStates.LATER_WHILE_OPEN;
    }

    /**
     * Get display options for a certain tabletquiz.
     * Equivalent to LMS display_options::make_from_tabletquiz.
     *
     * @param tabletquiz TabletQuiz.
     * @param state State.
     * @returns Display options.
     */
    getDisplayOptionsForTabletQuiz(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        state: AddonModTabletTabletQuizDisplayOptionsAttemptStates,
    ): AddonModTabletTabletQuizDisplayOptions {
        const marksOption = this.calculateDisplayOptionValue(
            tabletquiz.reviewmarks ?? 0,
            state,
            QuestionDisplayOptionsMarks.MARK_AND_MAX,
            QuestionDisplayOptionsMarks.MAX_ONLY,
        );
        const feedbackOption = this.calculateDisplayOptionValue(tabletquiz.reviewspecificfeedback ?? 0, state);

        return {
            attempt: this.calculateDisplayOptionValue(tabletquiz.reviewattempt ?? 0, state, true, false),
            correctness: this.calculateDisplayOptionValue(tabletquiz.reviewcorrectness ?? 0, state),
            marks: tabletquiz.reviewmaxmarks !== undefined ?
                this.calculateDisplayOptionValue<QuestionDisplayOptionsMarks | QuestionDisplayOptionsValues>(
                    tabletquiz.reviewmaxmarks,
                    state,
                    marksOption,
                    QuestionDisplayOptionsValues.HIDDEN,
                ) :
                marksOption,
            feedback: feedbackOption,
            generalfeedback: this.calculateDisplayOptionValue(tabletquiz.reviewgeneralfeedback ?? 0, state),
            rightanswer: this.calculateDisplayOptionValue(tabletquiz.reviewrightanswer ?? 0, state),
            overallfeedback: this.calculateDisplayOptionValue(tabletquiz.reviewoverallfeedback ?? 0, state),
            numpartscorrect: feedbackOption,
            manualcomment: feedbackOption,
            markdp: tabletquiz.questiondecimalpoints !== undefined && tabletquiz.questiondecimalpoints !== -1 ?
                tabletquiz.questiondecimalpoints :
                (tabletquiz.decimalpoints ?? 0),
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
    protected calculateDisplayOptionValue<T = AddonModTabletTabletQuizDisplayOptionValue>(
        setting: number,
        state: AddonModTabletTabletQuizDisplayOptionsAttemptStates,
        whenSet: T,
        whenNotSet: T,
    ): T;
    protected calculateDisplayOptionValue(
        setting: number,
        state: AddonModTabletTabletQuizDisplayOptionsAttemptStates,
    ): QuestionDisplayOptionsValues;
    protected calculateDisplayOptionValue(
        setting: number,
        state: AddonModTabletTabletQuizDisplayOptionsAttemptStates,
        whenSet: AddonModTabletTabletQuizDisplayOptionValue = QuestionDisplayOptionsValues.VISIBLE,
        whenNotSet: AddonModTabletTabletQuizDisplayOptionValue = QuestionDisplayOptionsValues.HIDDEN,
    ): AddonModTabletTabletQuizDisplayOptionValue {
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
            case AddonModTabletTabletQuizAttemptStates.IN_PROGRESS:
                return Translate.instant('addon.mod_tablettabletquiz.stateinprogress');

            case AddonModTabletTabletQuizAttemptStates.OVERDUE:
                return Translate.instant('addon.mod_tablettabletquiz.stateoverdue');

            case AddonModTabletTabletQuizAttemptStates.FINISHED:
                return Translate.instant('addon.mod_tablettabletquiz.statefinished');

            case AddonModTabletTabletQuizAttemptStates.ABANDONED:
                return Translate.instant('addon.mod_tablettabletquiz.stateabandoned');

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
            case AddonModTabletTabletQuizAttemptStates.IN_PROGRESS:
                return CoreIonicColorNames.WARNING;

            case AddonModTabletTabletQuizAttemptStates.OVERDUE:
                return CoreIonicColorNames.INFO;

            case AddonModTabletTabletQuizAttemptStates.FINISHED:
                return CoreIonicColorNames.SUCCESS;

            case AddonModTabletTabletQuizAttemptStates.ABANDONED:
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
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}attemptReview:${attemptId}`;
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
        options: AddonModTabletTabletQuizGetAttemptReviewOptions = {},
    ): Promise<AddonModTabletTabletQuizGetAttemptReviewResponse> {
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

        const result = await site.read<AddonModTabletTabletQuizGetAttemptReviewWSResponse>('mod_tablettabletquiz_get_attempt_review', params, preSets);

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
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}attemptSummary:${attemptId}`;
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
        options: AddonModTabletTabletQuizGetAttemptSummaryOptions = {},
    ): Promise<CoreQuestionQuestionParsed[]> {

        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletTabletQuizGetAttemptSummaryWSParams = {
            attemptid: attemptId,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletTabletQuizPreflightDataWSParam>(
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

        const response = await site.read<AddonModTabletTabletQuizGetAttemptSummaryWSResponse>('mod_tablettabletquiz_get_attempt_summary', params, preSets);

        const questions = CoreQuestion.parseQuestions(response.questions);

        if (options.loadLocal) {
            await AddonModTabletTabletQuizOffline.loadQuestionsLocalStates(attemptId, questions, site.getId());
        }

        return questions;
    }

    /**
     * Get cache key for get combined review options WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param userId User ID.
     * @returns Cache key.
     */
    protected getCombinedReviewOptionsCacheKey(tabletquizId: number, userId: number): string {
        return `${this.getCombinedReviewOptionsCommonCacheKey(tabletquizId)}:${userId}`;
    }

    /**
     * Get common cache key for get combined review options WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getCombinedReviewOptionsCommonCacheKey(tabletquizId: number): string {
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}combinedReviewOptions:${tabletquizId}`;
    }

    /**
     * Get a tabletquiz combined review options.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved with the combined review options.
     */
    async getCombinedReviewOptions(
        tabletquizId: number,
        options: AddonModTabletTabletQuizUserOptions = {},
    ): Promise<AddonModTabletTabletQuizCombinedReviewOptions> {
        const site = await CoreSites.getSite(options.siteId);

        const userId = options.userId || site.getUserId();
        const params: AddonModTabletTabletQuizGetCombinedReviewOptionsWSParams = {
            tabletquizid: tabletquizId,
            userid: userId,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getCombinedReviewOptionsCacheKey(tabletquizId, userId),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const response = await site.read<AddonModTabletTabletQuizGetCombinedReviewOptionsWSResponse>(
            'mod_tablettabletquiz_get_combined_review_options',
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
     * @param tabletquizId TabletQuiz ID.
     * @param grade Grade.
     * @returns Cache key.
     */
    protected getFeedbackForGradeCacheKey(tabletquizId: number, grade: number): string {
        return `${this.getFeedbackForGradeCommonCacheKey(tabletquizId)}:${grade}`;
    }

    /**
     * Get common cache key for get feedback for grade WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getFeedbackForGradeCommonCacheKey(tabletquizId: number): string {
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}feedbackForGrade:${tabletquizId}`;
    }

    /**
     * Get the feedback for a certain grade.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param grade Grade.
     * @param options Other options.
     * @returns Promise resolved with the feedback.
     */
    async getFeedbackForGrade(
        tabletquizId: number,
        grade: SafeNumber,
        options: CoreCourseCommonModWSOptions = {},
    ): Promise<AddonModTabletTabletQuizGetTabletQuizFeedbackForGradeWSResponse> {
        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletTabletQuizGetTabletQuizFeedbackForGradeWSParams = {
            tabletquizid: tabletquizId,
            grade: grade,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getFeedbackForGradeCacheKey(tabletquizId, grade),
            updateFrequency: CoreCacheUpdateFrequency.RARELY,
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        return site.read('mod_tablettabletquiz_get_tabletquiz_feedback_for_grade', params, preSets);
    }

    /**
     * Determine the correct number of decimal places required to format a grade.
     * Based on Moodle's tabletquiz_get_grade_format.
     *
     * @param tabletquiz TabletQuiz.
     * @returns Number of decimals.
     */
    getGradeDecimals(tabletquiz: AddonModTabletTabletQuizTabletQuizWSData): number {
        if (tabletquiz.questiondecimalpoints === undefined) {
            tabletquiz.questiondecimalpoints = -1;
        }

        if (tabletquiz.questiondecimalpoints == -1) {
            return tabletquiz.decimalpoints ?? 1;
        }

        return tabletquiz.questiondecimalpoints;
    }

    /**
     * Gets a tabletquiz grade and feedback from the gradebook.
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
    getLastCompletedAttemptFromList(attempts?: AddonModTabletTabletQuizAttemptWSData[]): AddonModTabletTabletQuizAttemptWSData | undefined {
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
     * Given a list of questions, check if the tabletquiz can be submitted.
     * Will return an array with the messages to prevent the submit. Empty array if tabletquiz can be submitted.
     *
     * @param questions Questions.
     * @returns List of prevent submit messages. Empty array if tabletquiz can be submitted.
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
     * Get cache key for tabletquiz data WS calls.
     *
     * @param courseId Course ID.
     * @returns Cache key.
     */
    protected getTabletQuizDataCacheKey(courseId: number): string {
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}tabletquiz:${courseId}`;
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
    protected async getTabletQuizByField(
        courseId: number,
        key: 'coursemodule' | 'id',
        value: number,
        options: CoreSitesCommonWSOptions = {},
    ): Promise<AddonModTabletTabletQuizTabletQuizWSData> {

        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletTabletQuizGetTabletQuizzesByCoursesWSParams = {
            courseids: [courseId],
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getTabletQuizDataCacheKey(courseId),
            updateFrequency: CoreCacheUpdateFrequency.RARELY,
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const response = await site.read<AddonModTabletTabletQuizGetTabletQuizzesByCoursesWSResponse>(
            'mod_tablettabletquiz_get_tabletquizzes_by_courses',
            params,
            preSets,
        );

        // Search the tabletquiz.
        return CoreCourseModuleHelper.getActivityByField(response.tabletquizzes, key, value);
    }

    /**
     * Get a tabletquiz by module ID.
     *
     * @param courseId Course ID.
     * @param cmId Course module ID.
     * @param options Other options.
     * @returns Promise resolved when the tabletquiz is retrieved.
     */
    getTabletQuiz(courseId: number, cmId: number, options: CoreSitesCommonWSOptions = {}): Promise<AddonModTabletTabletQuizTabletQuizWSData> {
        return this.getTabletQuizByField(courseId, 'coursemodule', cmId, options);
    }

    /**
     * Get a tabletquiz by tabletquiz ID.
     *
     * @param courseId Course ID.
     * @param id TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved when the tabletquiz is retrieved.
     */
    getTabletQuizById(courseId: number, id: number, options: CoreSitesCommonWSOptions = {}): Promise<AddonModTabletTabletQuizTabletQuizWSData> {
        return this.getTabletQuizByField(courseId, 'id', id, options);
    }

    /**
     * Get cache key for get tabletquiz access information WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getTabletQuizAccessInformationCacheKey(tabletquizId: number): string {
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}tabletquizAccessInformation:${tabletquizId}`;
    }

    /**
     * Get access information for an attempt.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved with the access information.
     */
    async getTabletQuizAccessInformation(
        tabletquizId: number,
        options: CoreCourseCommonModWSOptions = {},
    ): Promise<AddonModTabletTabletQuizGetTabletQuizAccessInformationWSResponse> {
        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletTabletQuizGetTabletQuizAccessInformationWSParams = {
            tabletquizid: tabletquizId,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getTabletQuizAccessInformationCacheKey(tabletquizId),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        return site.read('mod_tablettabletquiz_get_tabletquiz_access_information', params, preSets);
    }

    /**
     * Get a readable TabletQuiz grade method.
     *
     * @param method Grading method.
     * @returns Readable grading method.
     */
    getTabletQuizGradeMethod(method?: number | string): string {
        if (method === undefined) {
            return '';
        }

        if (typeof method == 'string') {
            method = parseInt(method, 10);
        }

        switch (method) {
            case AddonModTabletTabletQuizGradeMethods.HIGHEST_GRADE:
                return Translate.instant('addon.mod_tablettabletquiz.gradehighest');
            case AddonModTabletTabletQuizGradeMethods.AVERAGE_GRADE:
                return Translate.instant('addon.mod_tablettabletquiz.gradeaverage');
            case AddonModTabletTabletQuizGradeMethods.FIRST_ATTEMPT:
                return Translate.instant('addon.mod_tablettabletquiz.attemptfirst');
            case AddonModTabletTabletQuizGradeMethods.LAST_ATTEMPT:
                return Translate.instant('addon.mod_tablettabletquiz.attemptlast');
            default:
                return '';
        }
    }

    /**
     * Get cache key for get tabletquiz required qtypes WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getTabletQuizRequiredQtypesCacheKey(tabletquizId: number): string {
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}tabletquizRequiredQtypes:${tabletquizId}`;
    }

    /**
     * Get the potential question types that would be required for a given tabletquiz.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved with the access information.
     */
    async getTabletQuizRequiredQtypes(tabletquizId: number, options: CoreCourseCommonModWSOptions = {}): Promise<string[]> {
        const site = await CoreSites.getSite(options.siteId);

        const params: AddonModTabletTabletQuizGetTabletQuizRequiredQtypesWSParams = {
            tabletquizid: tabletquizId,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getTabletQuizRequiredQtypesCacheKey(tabletquizId),
            updateFrequency: CoreCacheUpdateFrequency.SOMETIMES,
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const response = await site.read<AddonModTabletTabletQuizGetTabletQuizRequiredQtypesWSResponse>(
            'mod_tablettabletquiz_get_tabletquiz_required_qtypes',
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
    getPagesFromLayoutAndQuestions(layout: string, questions: AddonModTabletTabletQuizQuestionsWithAnswers): number[] {
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
            if (!AddonModTabletTabletQuizAccessRuleDelegate.isAccessRuleSupported(name)) {
                notSupported.push(name);
            }
        });

        return notSupported;
    }

    /**
     * Get cache key for get user attempts WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param userId User ID.
     * @returns Cache key.
     */
    protected getUserAttemptsCacheKey(tabletquizId: number, userId: number): string {
        return `${this.getUserAttemptsCommonCacheKey(tabletquizId)}:${userId}`;
    }

    /**
     * Get common cache key for get user attempts WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getUserAttemptsCommonCacheKey(tabletquizId: number): string {
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}userAttempts:${tabletquizId}`;
    }

    /**
     * Get tabletquiz attempts for a certain user.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved with the attempts.
     */
    async getUserAttempts(
        tabletquizId: number,
        options: AddonModTabletTabletQuizGetUserAttemptsOptions = {},
    ): Promise<AddonModTabletTabletQuizAttemptWSData[]> {

        const status = options.status || 'all';
        const includePreviews = options.includePreviews === undefined ? true : options.includePreviews;

        const site = await CoreSites.getSite(options.siteId);

        const userId = options.userId || site.getUserId();
        const params: AddonModTabletTabletQuizGetUserAttemptsWSParams = {
            tabletquizid: tabletquizId,
            userid: userId,
            status: status,
            includepreviews: !!includePreviews,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getUserAttemptsCacheKey(tabletquizId, userId),
            updateFrequency: CoreCacheUpdateFrequency.SOMETIMES,
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        const response = await site.read<AddonModTabletTabletQuizGetUserAttemptsWSResponse>('mod_tablettabletquiz_get_user_attempts', params, preSets);

        return response.attempts;
    }

    /**
     * Get cache key for get user best grade WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param userId User ID.
     * @returns Cache key.
     */
    protected getUserBestGradeCacheKey(tabletquizId: number, userId: number): string {
        return `${this.getUserBestGradeCommonCacheKey(tabletquizId)}:${userId}`;
    }

    /**
     * Get common cache key for get user best grade WS calls.
     *
     * @param tabletquizId TabletQuiz ID.
     * @returns Cache key.
     */
    protected getUserBestGradeCommonCacheKey(tabletquizId: number): string {
        return `${AddonModTabletTabletQuizProvider.ROOT_CACHE_KEY}userBestGrade:${tabletquizId}`;
    }

    /**
     * Get best grade in a tabletquiz for a certain user.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param options Other options.
     * @returns Promise resolved with the best grade data.
     */
    async getUserBestGrade(tabletquizId: number, options: AddonModTabletTabletQuizUserOptions = {}): Promise<AddonModTabletTabletQuizGetUserBestGradeWSResponse> {
        const site = await CoreSites.getSite(options.siteId);

        const userId = options.userId || site.getUserId();
        const params: AddonModTabletTabletQuizGetUserBestGradeWSParams = {
            tabletquizid: tabletquizId,
            userid: userId,
        };
        const preSets: CoreSiteWSPreSets = {
            cacheKey: this.getUserBestGradeCacheKey(tabletquizId, userId),
            component: ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            componentId: options.cmId,
            ...CoreSites.getReadingStrategyPreSets(options.readingStrategy), // Include reading strategy preSets.
        };

        return site.read('mod_tablettabletquiz_get_user_best_grade', params, preSets);
    }

    /**
     * Invalidates all the data related to a certain tabletquiz.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param courseId Course ID.
     * @param attemptId Attempt ID to invalidate some WS calls.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined use site's current user.
     */
    async invalidateAllTabletQuizData(
        tabletquizId: number,
        courseId?: number,
        attemptId?: number,
        siteId?: string,
        userId?: number,
    ): Promise<void> {
        siteId = siteId || CoreSites.getCurrentSiteId();

        const promises: Promise<void>[] = [];

        promises.push(this.invalidateAttemptAccessInformation(tabletquizId, siteId));
        promises.push(this.invalidateCombinedReviewOptionsForUser(tabletquizId, siteId, userId));
        promises.push(this.invalidateFeedback(tabletquizId, siteId));
        promises.push(this.invalidateTabletQuizAccessInformation(tabletquizId, siteId));
        promises.push(this.invalidateTabletQuizRequiredQtypes(tabletquizId, siteId));
        promises.push(this.invalidateUserAttemptsForUser(tabletquizId, siteId, userId));
        promises.push(this.invalidateUserBestGradeForUser(tabletquizId, siteId, userId));

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
     * Invalidates attempt access information for all attempts in a tabletquiz.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateAttemptAccessInformation(tabletquizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getAttemptAccessInformationCommonCacheKey(tabletquizId));
    }

    /**
     * Invalidates attempt access information for an attempt.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param attemptId Attempt ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateAttemptAccessInformationForAttempt(tabletquizId: number, attemptId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getAttemptAccessInformationCacheKey(tabletquizId, attemptId));
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
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateCombinedReviewOptions(tabletquizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getCombinedReviewOptionsCommonCacheKey(tabletquizId));
    }

    /**
     * Invalidates combined review options for a certain user.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined use site's current user.
     */
    async invalidateCombinedReviewOptionsForUser(tabletquizId: number, siteId?: string, userId?: number): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getCombinedReviewOptionsCacheKey(tabletquizId, userId || site.getUserId()));
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
        const tabletquiz = await this.getTabletQuiz(courseId, moduleId, {
            readingStrategy: CoreSitesReadingStrategy.PREFER_CACHE,
            siteId,
        });

        const attempts = await this.getUserAttempts(tabletquiz.id, { cmId: moduleId, siteId });

        // Now invalidate it.
        const lastAttemptId = attempts.length ? attempts[attempts.length - 1].id : undefined;

        await this.invalidateAllTabletQuizData(tabletquiz.id, courseId, lastAttemptId, siteId);
    }

    /**
     * Invalidates feedback for all grades of a tabletquiz.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateFeedback(tabletquizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getFeedbackForGradeCommonCacheKey(tabletquizId));
    }

    /**
     * Invalidates feedback for a certain grade.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param grade Grade.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateFeedbackForGrade(tabletquizId: number, grade: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getFeedbackForGradeCacheKey(tabletquizId, grade));
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
     * Invalidates tabletquiz access information for a tabletquiz.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateTabletQuizAccessInformation(tabletquizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getTabletQuizAccessInformationCacheKey(tabletquizId));
    }

    /**
     * Invalidates required qtypes for a tabletquiz.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateTabletQuizRequiredQtypes(tabletquizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getTabletQuizRequiredQtypesCacheKey(tabletquizId));
    }

    /**
     * Invalidates user attempts for all users.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateUserAttempts(tabletquizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getUserAttemptsCommonCacheKey(tabletquizId));
    }

    /**
     * Invalidates user attempts for a certain user.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined use site's current user.
     */
    async invalidateUserAttemptsForUser(tabletquizId: number, siteId?: string, userId?: number): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getUserAttemptsCacheKey(tabletquizId, userId || site.getUserId()));
    }

    /**
     * Invalidates user best grade for all users.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateUserBestGrade(tabletquizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKeyStartingWith(this.getUserBestGradeCommonCacheKey(tabletquizId));
    }

    /**
     * Invalidates user best grade for a certain user.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined use site's current user.
     */
    async invalidateUserBestGradeForUser(tabletquizId: number, siteId?: string, userId?: number): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getUserBestGradeCacheKey(tabletquizId, userId || site.getUserId()));
    }

    /**
     * Invalidates tabletquiz data.
     *
     * @param courseId Course ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async invalidateTabletQuizData(courseId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.invalidateWsCacheForKey(this.getTabletQuizDataCacheKey(courseId));
    }

    /**
     * Check if an attempt is "completed": finished or abandoned.
     *
     * @param state Attempt's state.
     * @returns Whether it's finished.
     */
    isAttemptCompleted(state?: string): boolean {
        return state === AddonModTabletTabletQuizAttemptStates.FINISHED || state === AddonModTabletTabletQuizAttemptStates.ABANDONED;
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
            const attempt = await AddonModTabletTabletQuizOffline.getAttemptById(attemptId, siteId);

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
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @returns Whether it's nearly over or over.
     */
    isAttemptTimeNearlyOver(tabletquiz: AddonModTabletTabletQuizTabletQuizWSData, attempt: AddonModTabletTabletQuizAttemptWSData): boolean {
        if (attempt.state !== AddonModTabletTabletQuizAttemptStates.IN_PROGRESS) {
            // Attempt not in progress, return true.
            return true;
        }

        const dueDate = this.getAttemptDueDate(tabletquiz, attempt);
        const autoSavePeriod = tabletquiz.autosaveperiod || 0;

        if (dueDate > 0 && Date.now() + autoSavePeriod >= dueDate) {
            return true;
        }

        return false;
    }

    /**
     * Check if last attempt is offline and unfinished.
     *
     * @param tabletquiz TabletQuiz data.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User ID. If not defined, user current site's user.
     * @returns Promise resolved with boolean: true if last offline attempt is unfinished, false otherwise.
     */
    async isLastAttemptOfflineUnfinished(tabletquiz: AddonModTabletTabletQuizTabletQuizWSData, siteId?: string, userId?: number): Promise<boolean> {
        try {
            const attempts = await AddonModTabletTabletQuizOffline.getTabletQuizAttempts(tabletquiz.id, siteId, userId);

            const last = attempts.pop();

            return !!last && !last.finished;
        } catch {
            return false;
        }
    }

    /**
     * Check if a tabletquiz navigation is sequential.
     *
     * @param tabletquiz TabletQuiz.
     * @returns Whether navigation is sequential.
     */
    isNavigationSequential(tabletquiz: AddonModTabletTabletQuizTabletQuizWSData): boolean {
        return tabletquiz.navmethod === AddonModTabletTabletQuizNavMethods.SEQ;
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
     * Check if a tabletquiz is enabled to be used in offline.
     *
     * @param tabletquiz TabletQuiz.
     * @returns Whether offline is enabled.
     */
    isTabletQuizOffline(tabletquiz: AddonModTabletTabletQuizTabletQuizWSData): boolean {
        // Don't allow downloading the tabletquiz if offline is disabled to prevent wasting a lot of data when opening it.
        return !!tabletquiz.allowofflineattempts
            && !this.isNavigationSequential(tabletquiz)
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

        const params: AddonModTabletTabletQuizViewAttemptWSParams = {
            attemptid: attemptId,
            page: page,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
            ),
        };
        const promises: Promise<unknown>[] = [];

        promises.push(site.write('mod_tablettabletquiz_view_attempt', params));
        if (offline) {
            promises.push(AddonModTabletTabletQuizOffline.setAttemptCurrentPage(attemptId, page, site.getId()));
        }

        await Promise.all(promises);
    }

    /**
     * Report an attempt's review as being viewed.
     *
     * @param attemptId Attempt ID.
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when the WS call is successful.
     */
    logViewAttemptReview(attemptId: number, tabletquizId: number, siteId?: string): Promise<void> {
        const params: AddonModTabletTabletQuizViewAttemptReviewWSParams = {
            attemptid: attemptId,
        };

        return CoreCourseLogHelper.log(
            'mod_tablettabletquiz_view_attempt_review',
            params,
            ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            tabletquizId,
            siteId,
        );
    }

    /**
     * Report an attempt's summary as being viewed.
     *
     * @param attemptId Attempt ID.
     * @param preflightData Preflight required data (like password).
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when the WS call is successful.
     */
    logViewAttemptSummary(
        attemptId: number,
        preflightData: Record<string, string>,
        tabletquizId: number,
        siteId?: string,
    ): Promise<void> {
        const params: AddonModTabletTabletQuizViewAttemptSummaryWSParams = {
            attemptid: attemptId,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
            ),
        };

        return CoreCourseLogHelper.log(
            'mod_tablettabletquiz_view_attempt_summary',
            params,
            ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            tabletquizId,
            siteId,
        );
    }

    /**
     * Report a tabletquiz as being viewed.
     *
     * @param id Module ID.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when the WS call is successful.
     */
    logViewTabletQuiz(id: number, siteId?: string): Promise<void> {
        const params: AddonModTabletTabletQuizViewTabletQuizWSParams = {
            tabletquizid: id,
        };

        return CoreCourseLogHelper.log(
            'mod_tablettabletquiz_view_tabletquiz',
            params,
            ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
            id,
            siteId,
        );
    }

    /**
     * Process an attempt, saving its data.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @param data Data to save.
     * @param preflightData Preflight required data (like password).
     * @param finish Whether to finish the tabletquiz.
     * @param timeUp Whether the tabletquiz time is up, false otherwise.
     * @param offline Whether the attempt is offline.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved in success, rejected otherwise.
     */
    async processAttempt(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData,
        data: CoreQuestionsAnswers,
        preflightData: Record<string, string>,
        finish?: boolean,
        timeUp?: boolean,
        offline?: boolean,
        siteId?: string,
    ): Promise<void> {
        if (offline) {
            return this.processAttemptOffline(tabletquiz, attempt, data, preflightData, finish, siteId);
        }

        await this.processAttemptOnline(attempt.id, data, preflightData, finish, timeUp, siteId);
    }

    /**
     * Process an online attempt, saving its data.
     *
     * @param attemptId Attempt ID.
     * @param data Data to save.
     * @param preflightData Preflight required data (like password).
     * @param finish Whether to finish the tabletquiz.
     * @param timeUp Whether the tabletquiz time is up, false otherwise.
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

        const params: AddonModTabletTabletQuizProcessAttemptWSParams = {
            attemptid: attemptId,
            data: CoreObject.toArrayOfObjects(data, 'name', 'value'),
            finishattempt: !!finish,
            timeup: !!timeUp,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
            ),
        };

        const response = await site.write<AddonModTabletTabletQuizProcessAttemptWSResponse>('mod_tablettabletquiz_process_attempt', params);

        if (response.warnings?.length) {
            // Reject with the first warning.
            throw new CoreWSError(response.warnings[0]);
        }

        return response.state;
    }

    /**
     * Process an offline attempt, saving its data.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @param data Data to save.
     * @param preflightData Preflight required data (like password).
     * @param finish Whether to finish the tabletquiz.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved in success, rejected otherwise.
     */
    protected async processAttemptOffline(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData,
        data: CoreQuestionsAnswers,
        preflightData: Record<string, string>,
        finish?: boolean,
        siteId?: string,
    ): Promise<void> {

        // Get attempt summary to have the list of questions.
        const questionsArray = await this.getAttemptSummary(attempt.id, preflightData, {
            cmId: tabletquiz.coursemodule,
            loadLocal: true,
            readingStrategy: CoreSitesReadingStrategy.PREFER_CACHE,
            siteId,
        });

        // Convert the question array to an object.
        const questions = CoreArray.toObject(questionsArray, 'slot');

        return AddonModTabletTabletQuizOffline.processAttempt(tabletquiz, attempt, questions, data, finish, siteId);
    }

    /**
     * Check if it's a graded tabletquiz. Based on Moodle's tabletquiz_has_grades.
     *
     * @param tabletquiz TabletQuiz.
     * @returns Whether tabletquiz is graded.
     */
    tabletquizHasGrades(tabletquiz: AddonModTabletTabletQuizTabletQuizWSData): boolean {
        return (tabletquiz.grade ?? 0) >= 0.000005 && (tabletquiz.sumgrades ?? 0) >= 0.000005;
    }

    /**
     * Convert the raw grade into a grade out of the maximum grade for this tabletquiz.
     * Based on Moodle's tabletquiz_rescale_grade.
     *
     * @param rawGrade The unadjusted grade, for example attempt.sumgrades.
     * @param tabletquiz TabletQuiz.
     * @param format True to format the results for display, 'question' to format a question grade
     *               (different number of decimal places), false to not format it.
     * @returns Grade to display.
     */
    rescaleGrade(
        rawGrade: string | number | undefined | null,
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        format: boolean | string = true,
    ): string | undefined {
        let grade: number | undefined;

        const rawGradeNum = typeof rawGrade === 'string' ? parseFloat(rawGrade) : rawGrade;
        if (rawGradeNum !== undefined && rawGradeNum !== null && !isNaN(rawGradeNum)) {
            if (tabletquiz.sumgrades && tabletquiz.sumgrades >= 0.000005) {
                grade = rawGradeNum * (tabletquiz.grade ?? 0) / tabletquiz.sumgrades;
            } else {
                grade = 0;
            }
        }

        if (grade === null || grade === undefined) {
            return;
        }

        if (format === 'question') {
            return this.formatGrade(grade, this.getGradeDecimals(tabletquiz));
        } else if (format) {
            return this.formatGrade(grade, tabletquiz.decimalpoints ?? 1);
        }

        return String(grade);
    }

    /**
     * Save an attempt data.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @param data Data to save.
     * @param preflightData Preflight required data (like password).
     * @param offline Whether attempt is offline.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved in success, rejected otherwise.
     */
    async saveAttempt(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData,
        data: CoreQuestionsAnswers,
        preflightData: Record<string, string>,
        offline?: boolean,
        siteId?: string,
    ): Promise<void> {
        try {
            if (offline) {
                return await this.processAttemptOffline(tabletquiz, attempt, data, preflightData, false, siteId);
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

        const params: AddonModTabletTabletQuizSaveAttemptWSParams = {
            attemptid: attemptId,
            data: CoreObject.toArrayOfObjects(data, 'name', 'value'),
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
            ),
        };

        const response = await site.write<CoreStatusWithWarningsWSResponse>('mod_tablettabletquiz_save_attempt', params);

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
    shouldShowTimeLeft(rules: string[], attempt: AddonModTabletTabletQuizAttemptWSData, endTime: number): boolean {
        const timeNow = CoreTime.timestamp();

        if (attempt.state !== AddonModTabletTabletQuizAttemptStates.IN_PROGRESS) {
            return false;
        }

        return AddonModTabletTabletQuizAccessRuleDelegate.shouldShowTimeLeft(rules, attempt, endTime, timeNow);
    }

    /**
     * Start an attempt.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param preflightData Preflight required data (like password).
     * @param forceNew Whether to force a new attempt or not.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with the attempt data.
     */
    async startAttempt(
        tabletquizId: number,
        preflightData: Record<string, string>,
        forceNew?: boolean,
        siteId?: string,
    ): Promise<AddonModTabletTabletQuizAttemptWSData> {
        const site = await CoreSites.getSite(siteId);

        const params: AddonModTabletTabletQuizStartAttemptWSParams = {
            tabletquizid: tabletquizId,
            preflightdata: CoreObject.toArrayOfObjects<AddonModTabletTabletQuizPreflightDataWSParam>(
                preflightData,
                'name',
                'value',
            ),
            forcenew: !!forceNew,
        };

        const response = await site.write<AddonModTabletTabletQuizStartAttemptWSResponse>('mod_tablettabletquiz_start_attempt', params);

        if (response.warnings?.length) {
            // Reject with the first warning.
            throw new CoreWSError(response.warnings[0]);
        }

        return response.attempt;
    }

}

export const AddonModTabletTabletQuiz = makeSingleton(AddonModTabletTabletQuizProvider);

/**
 * Common options with user ID.
 */
export type AddonModTabletTabletQuizUserOptions = CoreCourseCommonModWSOptions & {
    userId?: number; // User ID. If not defined use site's current user.
};

/**
 * Options to pass to getAllQuestionsData.
 */
export type AddonModTabletTabletQuizAllQuestionsDataOptions = CoreCourseCommonModWSOptions & {
    pages?: number[]; // List of pages to get. If not defined, all pages.
};

/**
 * Options to pass to getAttemptReview.
 */
export type AddonModTabletTabletQuizGetAttemptReviewOptions = CoreCourseCommonModWSOptions & {
    page?: number; // List of pages to get. If not defined, all pages.
};

/**
 * Options to pass to getAttemptSummary.
 */
export type AddonModTabletTabletQuizGetAttemptSummaryOptions = CoreCourseCommonModWSOptions & {
    loadLocal?: boolean; // Whether it should load local state for each question.
};

/**
 * Options to pass to getUserAttempts.
 */
export type AddonModTabletTabletQuizGetUserAttemptsOptions = CoreCourseCommonModWSOptions & {
    status?: string; // Status of the attempts to get. By default, 'all'.
    includePreviews?: boolean; // Whether to include previews. Defaults to true.
    userId?: number; // User ID. If not defined use site's current user.
};

/**
 * Preflight data in the format accepted by the WebServices.
 */
type AddonModTabletTabletQuizPreflightDataWSParam = {
    name: string; // Data name.
    value: string; // Data value.
};

/**
 * Params of mod_tablettabletquiz_get_attempt_access_information WS.
 */
export type AddonModTabletTabletQuizGetAttemptAccessInformationWSParams = {
    tabletquizid: number; // TabletQuiz instance id.
    attemptid?: number; // Attempt id, 0 for the user last attempt if exists.
};

/**
 * Data returned by mod_tablettabletquiz_get_attempt_access_information WS.
 */
export type AddonModTabletTabletQuizGetAttemptAccessInformationWSResponse = {
    endtime?: number; // When the attempt must be submitted (determined by rules).
    isfinished: boolean; // Whether there is no way the user will ever be allowed to attempt.
    ispreflightcheckrequired?: boolean; // Whether a check is required before the user starts/continues his attempt.
    preventnewattemptreasons: string[]; // List of reasons.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tablettabletquiz_get_attempt_data WS.
 */
export type AddonModTabletTabletQuizGetAttemptDataWSParams = {
    attemptid: number; // Attempt id.
    page: number; // Page number.
    preflightdata?: AddonModTabletTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Data returned by mod_tablettabletquiz_get_attempt_data WS.
 */
export type AddonModTabletTabletQuizGetAttemptDataWSResponse = {
    attempt: AddonModTabletTabletQuizAttemptWSData;
    messages: string[]; // Access messages, will only be returned for users with mod/tabletquiz:preview capability.
    nextpage: number; // Next page number.
    questions: CoreQuestionQuestionWSData[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * Attempt data returned by several WebServices.
 */
export type AddonModTabletTabletQuizAttemptWSData = {
    id: number; // Attempt id.
    tabletquiz?: number; // Foreign key reference to the tabletquiz that was attempted.
    userid?: number; // Foreign key reference to the user whose attempt this is.
    attempt?: number; // Sequentially numbers this students attempts at this tabletquiz.
    uniqueid?: number; // Foreign key reference to the question_usage that holds the details of the the question_attempts.
    layout?: string; // Attempt layout.
    currentpage?: number; // Attempt current page.
    preview?: number; // Whether is a preview attempt or not.
    state?: string; // The current state of the attempts. 'inprogress', 'overdue', 'finished' or 'abandoned'.
    timestart?: number; // Time when the attempt was started.
    timefinish?: number; // Time when the attempt was submitted. 0 if the attempt has not been submitted yet.
    timemodified?: number; // Last modified time.
    timemodifiedoffline?: number; // Last modified time via webservices.
    timecheckstate?: number; // Next time tabletquiz cron should check attempt for state changes. NULL means never check.
    sumgrades?: SafeNumber | null; // Total marks for this attempt.
    gradeitemmarks?: { // @since 4.4. If the tabletquiz has additional grades set up, the mark for each grade for this attempt.
        name: string; // The name of this grade item.
        grade: number; // The grade this attempt earned for this item.
        maxgrade: number; // The total this grade is out of.
    }[];
};

/**
 * Get attempt data response with parsed questions.
 */
export type AddonModTabletTabletQuizGetAttemptDataResponse = Omit<AddonModTabletTabletQuizGetAttemptDataWSResponse, 'questions'> & {
    questions: CoreQuestionQuestionParsed[];
};

/**
 * Params of mod_tablettabletquiz_get_attempt_review WS.
 */
export type AddonModTabletTabletQuizGetAttemptReviewWSParams = {
    attemptid: number; // Attempt id.
    page?: number; // Page number, empty for all the questions in all the pages.
};

/**
 * Data returned by mod_tablettabletquiz_get_attempt_review WS.
 */
export type AddonModTabletTabletQuizGetAttemptReviewWSResponse = {
    grade: string; // Grade for the tabletquiz (or empty or "notyetgraded").
    attempt: AddonModTabletTabletQuizAttemptWSData;
    additionaldata: AddonModTabletTabletQuizWSAdditionalData[];
    questions: CoreQuestionQuestionWSData[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * Additional data returned by mod_tablettabletquiz_get_attempt_review WS.
 */
export type AddonModTabletTabletQuizWSAdditionalData = {
    id: string; // Id of the data.
    title: string; // Data title.
    content: string; // Data content.
};

/**
 * Get attempt review response with parsed questions.
 */
export type AddonModTabletTabletQuizGetAttemptReviewResponse = Omit<AddonModTabletTabletQuizGetAttemptReviewWSResponse, 'questions'> & {
    questions: CoreQuestionQuestionParsed[];
};

/**
 * Params of mod_tablettabletquiz_get_attempt_summary WS.
 */
export type AddonModTabletTabletQuizGetAttemptSummaryWSParams = {
    attemptid: number; // Attempt id.
    preflightdata?: AddonModTabletTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Data returned by mod_tablettabletquiz_get_attempt_summary WS.
 */
export type AddonModTabletTabletQuizGetAttemptSummaryWSResponse = {
    questions: CoreQuestionQuestionWSData[];
    totalunanswered?: number; // @since 4.4. Total unanswered questions.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tablettabletquiz_get_combined_review_options WS.
 */
export type AddonModTabletTabletQuizGetCombinedReviewOptionsWSParams = {
    tabletquizid: number; // TabletQuiz instance id.
    userid?: number; // User id (empty for current user).
};

/**
 * Data returned by mod_tablettabletquiz_get_combined_review_options WS.
 */
export type AddonModTabletTabletQuizGetCombinedReviewOptionsWSResponse = {
    someoptions: AddonModTabletTabletQuizWSReviewOption[];
    alloptions: AddonModTabletTabletQuizWSReviewOption[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * Option data returned by mod_tablettabletquiz_get_combined_review_options.
 */
export type AddonModTabletTabletQuizWSReviewOption = {
    name: string; // Option name.
    value: number; // Option value.
};

/**
 * Data returned by mod_tablettabletquiz_get_combined_review_options WS, formatted to convert the options to objects.
 */
export type AddonModTabletTabletQuizCombinedReviewOptions = Omit<AddonModTabletTabletQuizGetCombinedReviewOptionsWSResponse, 'alloptions'|'someoptions'> & {
    someoptions: Record<string, number>;
    alloptions: Record<string, number>;
};

/**
 * Params of mod_tablettabletquiz_get_tabletquiz_feedback_for_grade WS.
 */
export type AddonModTabletTabletQuizGetTabletQuizFeedbackForGradeWSParams = {
    tabletquizid: number; // TabletQuiz instance id.
    grade: number; // The grade to check.
};

/**
 * Data returned by mod_tablettabletquiz_get_tabletquiz_feedback_for_grade WS.
 */
export type AddonModTabletTabletQuizGetTabletQuizFeedbackForGradeWSResponse = {
    feedbacktext: string; // The comment that corresponds to this grade (empty for none).
    feedbacktextformat?: CoreTextFormat; // Feedbacktext format (1 = HTML, 0 = MOODLE, 2 = PLAIN or 4 = MARKDOWN).
    feedbackinlinefiles?: CoreWSExternalFile[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tablettabletquiz_get_tabletquizzes_by_courses WS.
 */
export type AddonModTabletTabletQuizGetTabletQuizzesByCoursesWSParams = {
    courseids?: number[]; // Array of course ids.
};

/**
 * Data returned by mod_tablettabletquiz_get_tabletquizzes_by_courses WS.
 */
export type AddonModTabletTabletQuizGetTabletQuizzesByCoursesWSResponse = {
    tabletquizzes: AddonModTabletTabletQuizTabletQuizWSData[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * TabletQuiz data returned by mod_tablettabletquiz_get_tabletquizzes_by_courses WS.
 */
export type AddonModTabletTabletQuizTabletQuizWSData = CoreCourseModuleStandardElements & {
    timeopen?: number; // The time when this tabletquiz opens. (0 = no restriction.).
    timeclose?: number; // The time when this tabletquiz closes. (0 = no restriction.).
    timelimit?: number; // The time limit for tabletquiz attempts, in seconds.
    overduehandling?: string; // The method used to handle overdue attempts. 'autosubmit', 'graceperiod' or 'autoabandon'.
    graceperiod?: number; // The amount of time (in seconds) after time limit during which attempts can still be submitted.
    preferredbehaviour?: string; // The behaviour to ask questions to use.
    canredoquestions?: number; // Allows students to redo any completed question within a tabletquiz attempt.
    attempts?: number; // The maximum number of attempts a student is allowed.
    attemptonlast?: number; // Whether subsequent attempts start from the answer to the previous attempt (1) or start blank (0).
    grademethod?: number; // One of the values QUIZ_GRADEHIGHEST, QUIZ_GRADEAVERAGE, QUIZ_ATTEMPTFIRST or QUIZ_ATTEMPTLAST.
    decimalpoints?: number; // Number of decimal points to use when displaying grades.
    questiondecimalpoints?: number; // Number of decimal points to use when displaying question grades.
    reviewattempt?: number; // Whether users are allowed to review their tabletquiz attempts at various times.
    reviewcorrectness?: number; // Whether users are allowed to review their tabletquiz attempts at various times.
    reviewmaxmarks?: number; // @since 4.3. Whether users are allowed to review their tabletquiz attempts at various times.
    reviewmarks?: number; // Whether users are allowed to review their tabletquiz attempts at various times.
    reviewspecificfeedback?: number; // Whether users are allowed to review their tabletquiz attempts at various times.
    reviewgeneralfeedback?: number; // Whether users are allowed to review their tabletquiz attempts at various times.
    reviewrightanswer?: number; // Whether users are allowed to review their tabletquiz attempts at various times.
    reviewoverallfeedback?: number; // Whether users are allowed to review their tabletquiz attempts at various times.
    questionsperpage?: number; // How often to insert a page break when editing the tabletquiz, or when shuffling the question order.
    navmethod?: AddonModTabletTabletQuizNavMethods; // Any constraints on how the user is allowed to navigate around the tabletquiz.
    shuffleanswers?: number; // Whether the parts of the question should be shuffled, in those question types that support it.
    sumgrades?: number | null; // The total of all the question instance maxmarks.
    grade?: number; // The total that the tabletquiz overall grade is scaled to be out of.
    timecreated?: number; // The time when the tabletquiz was added to the course.
    timemodified?: number; // Last modified time.
    password?: string; // A password that the student must enter before starting or continuing a tabletquiz attempt.
    subnet?: string; // Used to restrict the IP addresses from which this tabletquiz can be attempted.
    browsersecurity?: string; // Restriciton on the browser the student must use. E.g. 'securewindow'.
    delay1?: number; // Delay that must be left between the first and second attempt, in seconds.
    delay2?: number; // Delay that must be left between the second and subsequent attempt, in seconds.
    showuserpicture?: number; // Option to show the user's picture during the attempt and on the review page.
    showblocks?: number; // Whether blocks should be shown on the attempt.php and review.php pages.
    completionattemptsexhausted?: number; // Mark tabletquiz complete when the student has exhausted the maximum number of attempts.
    completionpass?: number; // Whether to require passing grade.
    allowofflineattempts?: number; // Whether to allow the tabletquiz to be attempted offline in the mobile app.
    autosaveperiod?: number; // Auto-save delay.
    hasfeedback?: number; // Whether the tabletquiz has any non-blank feedback text.
    hasquestions?: number; // Whether the tabletquiz has questions.
};

/**
 * Params of mod_tablettabletquiz_get_tabletquiz_access_information WS.
 */
export type AddonModTabletTabletQuizGetTabletQuizAccessInformationWSParams = {
    tabletquizid: number; // TabletQuiz instance id.
};

/**
 * Data returned by mod_tablettabletquiz_get_tabletquiz_access_information WS.
 */
export type AddonModTabletTabletQuizGetTabletQuizAccessInformationWSResponse = {
    canattempt: boolean; // Whether the user can do the tabletquiz or not.
    canmanage: boolean; // Whether the user can edit the tabletquiz settings or not.
    canpreview: boolean; // Whether the user can preview the tabletquiz or not.
    canreviewmyattempts: boolean; // Whether the users can review their previous attempts or not.
    canviewreports: boolean; // Whether the user can view the tabletquiz reports or not.
    accessrules: string[]; // List of rules.
    activerulenames: string[]; // List of active rules.
    preventaccessreasons: string[]; // List of reasons.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tablettabletquiz_get_tabletquiz_required_qtypes WS.
 */
export type AddonModTabletTabletQuizGetTabletQuizRequiredQtypesWSParams = {
    tabletquizid: number; // TabletQuiz instance id.
};

/**
 * Data returned by mod_tablettabletquiz_get_tabletquiz_required_qtypes WS.
 */
export type AddonModTabletTabletQuizGetTabletQuizRequiredQtypesWSResponse = {
    questiontypes: string[]; // List of question types used in the tabletquiz.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tablettabletquiz_get_user_attempts WS.
 */
export type AddonModTabletTabletQuizGetUserAttemptsWSParams = {
    tabletquizid: number; // TabletQuiz instance id.
    userid?: number; // User id, empty for current user.
    status?: string; // TabletQuiz status: all, finished or unfinished.
    includepreviews?: boolean; // Whether to include previews or not.
};

/**
 * Data returned by mod_tablettabletquiz_get_user_attempts WS.
 */
export type AddonModTabletTabletQuizGetUserAttemptsWSResponse = {
    attempts: AddonModTabletTabletQuizAttemptWSData[];
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tablettabletquiz_get_user_best_grade WS.
 */
export type AddonModTabletTabletQuizGetUserBestGradeWSParams = {
    tabletquizid: number; // TabletQuiz instance id.
    userid?: number; // User id.
};

/**
 * Data returned by mod_tablettabletquiz_get_user_best_grade WS.
 */
export type AddonModTabletTabletQuizGetUserBestGradeWSResponse = {
    hasgrade: boolean; // Whether the user has a grade on the given tabletquiz.
    grade?: SafeNumber; // The grade (only if the user has a grade).
    gradetopass?: number; // @since 3.11. The grade to pass the tabletquiz (only if set).
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tablettabletquiz_view_attempt WS.
 */
export type AddonModTabletTabletQuizViewAttemptWSParams = {
    attemptid: number; // Attempt id.
    page: number; // Page number.
    preflightdata?: AddonModTabletTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Params of mod_tablettabletquiz_process_attempt WS.
 */
export type AddonModTabletTabletQuizProcessAttemptWSParams = {
    attemptid: number; // Attempt id.
    data?: { // The data to be saved.
        name: string; // Data name.
        value: string; // Data value.
    }[];
    finishattempt?: boolean; // Whether to finish or not the attempt.
    timeup?: boolean; // Whether the WS was called by a timer when the time is up.
    preflightdata?: AddonModTabletTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Data returned by mod_tablettabletquiz_process_attempt WS.
 */
export type AddonModTabletTabletQuizProcessAttemptWSResponse = {
    state: string; // The new attempt state: inprogress, finished, overdue, abandoned.
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tablettabletquiz_save_attempt WS.
 */
export type AddonModTabletTabletQuizSaveAttemptWSParams = {
    attemptid: number; // Attempt id.
    data: { // The data to be saved.
        name: string; // Data name.
        value: string; // Data value.
    }[];
    preflightdata?: AddonModTabletTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Params of mod_tablettabletquiz_start_attempt WS.
 */
export type AddonModTabletTabletQuizStartAttemptWSParams = {
    tabletquizid: number; // TabletQuiz instance id.
    preflightdata?: AddonModTabletTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
    forcenew?: boolean; // Whether to force a new attempt or not.
};

/**
 * Data returned by mod_tablettabletquiz_start_attempt WS.
 */
export type AddonModTabletTabletQuizStartAttemptWSResponse = {
    attempt: AddonModTabletTabletQuizAttemptWSData;
    warnings?: CoreWSExternalWarning[];
};

/**
 * Params of mod_tablettabletquiz_view_attempt_review WS.
 */
export type AddonModTabletTabletQuizViewAttemptReviewWSParams = {
    attemptid: number; // Attempt id.
};

/**
 * Params of mod_tablettabletquiz_view_attempt_summary WS.
 */
export type AddonModTabletTabletQuizViewAttemptSummaryWSParams = {
    attemptid: number; // Attempt id.
    preflightdata?: AddonModTabletTabletQuizPreflightDataWSParam[]; // Preflight required data (like passwords).
};

/**
 * Params of mod_tablettabletquiz_view_tabletquiz WS.
 */
export type AddonModTabletTabletQuizViewTabletQuizWSParams = {
    tabletquizid: number; // TabletQuiz instance id.
};

/**
 * Data passed to ADDON_MOD_TABLETQUIZ_ATTEMPT_FINISHED_EVENT event.
 */
export type AddonModTabletTabletQuizAttemptFinishedData = {
    tabletquizId: number;
    attemptId: number;
    synced: boolean;
};

/**
 * TabletQuiz display option value.
 */
export type AddonModTabletTabletQuizDisplayOptionValue = QuestionDisplayOptionsMarks | QuestionDisplayOptionsValues | boolean;

/**
 * TabletQuiz display options, it can be used to determine which options to display.
 */
export type AddonModTabletTabletQuizDisplayOptions = {
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
