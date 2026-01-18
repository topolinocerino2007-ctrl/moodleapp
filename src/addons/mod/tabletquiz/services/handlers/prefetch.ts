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

import { DownloadStatus } from '@/core/constants';
import { isSafeNumber } from '@/core/utils/types';

import { Injectable } from '@angular/core';
import { CoreError } from '@classes/errors/error';
import { CoreCourseActivityPrefetchHandlerBase } from '@features/course/classes/activity-prefetch-handler';
import { CoreCourseAnyModuleData, CoreCourseCommonModWSOptions } from '@features/course/services/course';
import { CoreCourses } from '@features/courses/services/courses';
import { CoreQuestionHelper } from '@features/question/services/question-helper';
import { CoreFilepool } from '@services/filepool';
import { CoreSites, CoreSitesReadingStrategy } from '@services/sites';
import { CoreText } from '@singletons/text';
import { CorePromiseUtils } from '@singletons/promise-utils';
import { CoreWSFile } from '@services/ws';
import { makeSingleton } from '@singletons';
import {
    AddonModTabletTabletQuiz,
    AddonModTabletTabletQuizAttemptWSData,
    AddonModTabletTabletQuizGetTabletQuizAccessInformationWSResponse,
    AddonModTabletTabletQuizTabletQuizWSData,
} from '../tabletquiz';
import { AddonModTabletTabletQuizHelper } from '../tabletquiz-helper';
import { AddonModTabletTabletQuizSync, AddonModTabletTabletQuizSyncResult } from '../tabletquiz-sync';
import { AddonModTabletTabletQuizAttemptStates, ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, ADDON_MOD_TABLETQUIZ_MODNAME } from '../../constants';

/**
 * Handler to prefetch tabletquizzes.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletTabletQuizPrefetchHandlerService extends CoreCourseActivityPrefetchHandlerBase {

    name = 'AddonModTabletTabletQuiz';
    modName = ADDON_MOD_TABLETQUIZ_MODNAME;
    component = ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY;
    updatesNames = /^configuration$|^.*files$|^grades$|^gradeitems$|^questions$|^attempts$/;

    /**
     * Download the module.
     *
     * @param module The module object returned by WS.
     * @param courseId Course ID.
     * @param dirPath Path of the directory where to store all the content files.
     * @param single True if we're downloading a single module, false if we're downloading a whole section.
     * @param canStart If true, start a new attempt if needed.
     * @returns Promise resolved when all content is downloaded.
     */
    download(
        module: CoreCourseAnyModuleData,
        courseId: number,
        dirPath?: string,
        single?: boolean,
        canStart: boolean = true,
    ): Promise<void> {
        // Same implementation for download and prefetch.
        return this.prefetch(module, courseId, single, dirPath, canStart);
    }

    /**
     * Get list of files. If not defined, we'll assume they're in module.contents.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to.
     * @param single True if we're downloading a single module, false if we're downloading a whole section.
     * @returns Promise resolved with the list of files.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async getFiles(module: CoreCourseAnyModuleData, courseId: number, single?: boolean): Promise<CoreWSFile[]> {
        try {
            const tabletquiz = await AddonModTabletTabletQuiz.getTabletQuiz(courseId, module.id);

            const files = this.getIntroFilesFromInstance(module, tabletquiz);

            const attempts = await AddonModTabletTabletQuiz.getUserAttempts(tabletquiz.id, {
                cmId: module.id,
                readingStrategy: CoreSitesReadingStrategy.ONLY_NETWORK,
            });

            const attemptFiles = await this.getAttemptsFeedbackFiles(tabletquiz, attempts);

            return files.concat(attemptFiles);
        } catch {
            // TabletQuiz not found, return empty list.
            return [];
        }
    }

    /**
     * Get the list of downloadable files on feedback attemptss.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempts TabletQuiz user attempts.
     * @param siteId Site ID. If not defined, current site.
     * @returns List of Files.
     */
    protected async getAttemptsFeedbackFiles(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempts: AddonModTabletTabletQuizAttemptWSData[],
        siteId?: string,
    ): Promise<CoreWSFile[]> {
        let files: CoreWSFile[] = [];

        await Promise.all(attempts.map(async (attempt) => {
            if (!AddonModTabletTabletQuiz.isAttemptCompleted(attempt.state)) {
                // Attempt not completed, no feedback files.
                return;
            }

            const attemptGrade = AddonModTabletTabletQuiz.rescaleGrade(attempt.sumgrades, tabletquiz, false);
            const attemptGradeNumber = attemptGrade !== undefined && Number(attemptGrade);
            if (!isSafeNumber(attemptGradeNumber)) {
                return;
            }

            const feedback = await AddonModTabletTabletQuiz.getFeedbackForGrade(tabletquiz.id, attemptGradeNumber, {
                cmId: tabletquiz.coursemodule,
                readingStrategy: CoreSitesReadingStrategy.ONLY_NETWORK,
                siteId,
            });

            if (feedback.feedbackinlinefiles?.length) {
                files = files.concat(feedback.feedbackinlinefiles);
            }
        }));

        return files;
    }

    /**
     * Invalidate the prefetched content.
     *
     * @param moduleId The module ID.
     * @param courseId The course ID the module belongs to.
     */
    async invalidateContent(moduleId: number, courseId: number): Promise<void> {
        await AddonModTabletTabletQuiz.invalidateContent(moduleId, courseId);
    }

    /**
     * Invalidate WS calls needed to determine module status.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to.
     * @returns Promise resolved when invalidated.
     */
    async invalidateModule(module: CoreCourseAnyModuleData, courseId: number): Promise<void> {
        // Invalidate the calls required to check if a tabletquiz is downloadable.
        await Promise.all([
            AddonModTabletTabletQuiz.invalidateTabletQuizData(courseId),
            AddonModTabletTabletQuiz.invalidateUserAttemptsForUser(module.instance),
        ]);
    }

    /**
     * Check if a module can be downloaded. If the function is not defined, we assume that all modules are downloadable.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to.
     * @returns Whether the module can be downloaded. The promise should never be rejected.
     */
    async isDownloadable(module: CoreCourseAnyModuleData, courseId: number): Promise<boolean> {
        if (CoreSites.getCurrentSite()?.isOfflineDisabled()) {
            // Don't allow downloading the tabletquiz if offline is disabled to prevent wasting a lot of data when opening it.
            return false;
        }

        const siteId = CoreSites.getCurrentSiteId();

        const tabletquiz = await AddonModTabletTabletQuiz.getTabletQuiz(courseId, module.id, { siteId });

        if (!AddonModTabletTabletQuiz.isTabletQuizOffline(tabletquiz) || tabletquiz.hasquestions === 0) {
            return false;
        }

        // Not downloadable if we reached max attempts or the tabletquiz has an unfinished attempt.
        const attempts = await AddonModTabletTabletQuiz.getUserAttempts(tabletquiz.id, {
            cmId: module.id,
            siteId,
        });

        const isLastCompleted = !attempts.length || AddonModTabletTabletQuiz.isAttemptCompleted(attempts[attempts.length - 1].state);

        return tabletquiz.attempts === 0 || (tabletquiz.attempts ?? 0) > attempts.length || !isLastCompleted;
    }

    /**
     * @inheritdoc
     */
    async isEnabled(): Promise<boolean> {
        return true;
    }

    /**
     * @inheritdoc
     */
    async prefetch(
        module: SyncedModule,
        courseId: number,
        single?: boolean,
        dirPath?: string,
        canStart: boolean = true,
    ): Promise<void> {
        if (module.attemptFinished) {
            // Delete the value so it does not block anything if true.
            delete module.attemptFinished;

            // TabletQuiz got synced recently and an attempt has finished. Do not prefetch.
            return;
        }

        return this.prefetchPackage(module, courseId, (siteId) => this.prefetchTabletQuiz(module, courseId, !!single, canStart, siteId));
    }

    /**
     * Prefetch a tabletquiz.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to.
     * @param single True if we're downloading a single module, false if we're downloading a whole section.
     * @param canStart If true, start a new attempt if needed.
     * @param siteId Site ID.
     */
    protected async prefetchTabletQuiz(
        module: CoreCourseAnyModuleData,
        courseId: number,
        single: boolean,
        canStart: boolean,
        siteId: string,
    ): Promise<void> {
        const commonOptions = {
            readingStrategy: CoreSitesReadingStrategy.ONLY_NETWORK,
            siteId,
        };
        const modOptions = {
            cmId: module.id,
            ...commonOptions, // Include all common options.
        };

        // Get tabletquiz.
        const tabletquiz = await AddonModTabletTabletQuiz.getTabletQuiz(courseId, module.id, commonOptions);

        const introFiles = this.getIntroFilesFromInstance(module, tabletquiz);

        // Prefetch some tabletquiz data.
        // eslint-disable-next-line prefer-const
        let [tabletquizAccessInfo, attempts, attemptAccessInfo] = await Promise.all([
            AddonModTabletTabletQuiz.getTabletQuizAccessInformation(tabletquiz.id, modOptions),
            AddonModTabletTabletQuiz.getUserAttempts(tabletquiz.id, modOptions),
            AddonModTabletTabletQuiz.getAttemptAccessInformation(tabletquiz.id, 0, modOptions),
            AddonModTabletTabletQuiz.getTabletQuizRequiredQtypes(tabletquiz.id, modOptions),
            CoreFilepool.addFilesToQueue(siteId, introFiles, ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, module.id),
        ]);

        // Check if we need to start a new attempt.
        let attempt: AddonModTabletTabletQuizAttemptWSData | undefined = attempts[attempts.length - 1];
        let preflightData: Record<string, string> = {};
        let startAttempt = false;

        if (canStart || attempt) {
            if (canStart && (!attempt || AddonModTabletTabletQuiz.isAttemptCompleted(attempt.state))) {
                // Check if the user can attempt the tabletquiz.
                if (attemptAccessInfo.preventnewattemptreasons.length) {
                    throw new CoreError(CoreText.buildMessage(attemptAccessInfo.preventnewattemptreasons));
                }

                startAttempt = true;
                attempt = undefined;
            }

            // Get the preflight data. This function will also start a new attempt if needed.
            preflightData =
                await AddonModTabletTabletQuizHelper.getPreflightDataToAttemptOffline(
                    tabletquiz,
                    tabletquizAccessInfo,
                    attempt,
                    single,
                    'core.download',
                    siteId,
                );
        }

        const promises: Promise<unknown>[] = [];

        if (startAttempt) {
            // Re-fetch user attempts since we created a new one.
            promises.push(AddonModTabletTabletQuiz.getUserAttempts(tabletquiz.id, modOptions).then(async (atts) => {
                attempts = atts;

                const attemptFiles = await this.getAttemptsFeedbackFiles(tabletquiz, attempts, siteId);

                return CoreFilepool.addFilesToQueue(siteId, attemptFiles, ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, module.id);
            }));

            // Update the download time to prevent detecting the new attempt as an update.
            promises.push(CorePromiseUtils.ignoreErrors(
                CoreFilepool.updatePackageDownloadTime(siteId, ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, module.id),
            ));
        } else {
            // Use the already fetched attempts.
            promises.push(this.getAttemptsFeedbackFiles(tabletquiz, attempts, siteId).then((attemptFiles) =>
                CoreFilepool.addFilesToQueue(siteId, attemptFiles, ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, module.id)));
        }

        // Fetch attempt related data.
        promises.push(AddonModTabletTabletQuiz.getCombinedReviewOptions(tabletquiz.id, modOptions));
        promises.push(AddonModTabletTabletQuiz.getUserBestGrade(tabletquiz.id, modOptions));
        promises.push(this.prefetchGradeAndFeedback(tabletquiz, modOptions, siteId));
        promises.push(AddonModTabletTabletQuiz.getAttemptAccessInformation(tabletquiz.id, 0, modOptions)); // Last attempt.

        // Get course data, needed to determine upload max size if it's configured to be course limit.
        promises.push(CorePromiseUtils.ignoreErrors(CoreCourses.getCourseByField('id', courseId, siteId)));

        await Promise.all(promises);

        // We have tabletquiz data, now we'll get specific data for each attempt.
        await Promise.all(attempts.map(async (attempt) => {
            await this.prefetchAttempt(tabletquiz, tabletquizAccessInfo, attempt, preflightData, siteId);
        }));

        if (!canStart) {
            // Nothing else to do.
            return;
        }

        // If there's nothing to send, mark the tabletquiz as synchronized.
        const hasData = await AddonModTabletTabletQuizSync.hasDataToSync(tabletquiz.id, siteId);

        if (!hasData) {
            AddonModTabletTabletQuizSync.setSyncTime(tabletquiz.id, siteId);
        }
    }

    /**
     * Prefetch all WS data for an attempt.
     *
     * @param tabletquiz TabletQuiz.
     * @param accessInfo TabletQuiz access info.
     * @param attempt Attempt.
     * @param preflightData Preflight required data (like password).
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when the prefetch is finished. Data returned is not reliable.
     */
    async prefetchAttempt(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        accessInfo: AddonModTabletTabletQuizGetTabletQuizAccessInformationWSResponse,
        attempt: AddonModTabletTabletQuizAttemptWSData,
        preflightData: Record<string, string>,
        siteId?: string,
    ): Promise<void> {
        const isSequential = AddonModTabletTabletQuiz.isNavigationSequential(tabletquiz);
        let promises: Promise<unknown>[] = [];

        const modOptions: CoreCourseCommonModWSOptions = {
            cmId: tabletquiz.coursemodule,
            readingStrategy: CoreSitesReadingStrategy.ONLY_NETWORK,
            siteId,
        };

        if (AddonModTabletTabletQuiz.isAttemptCompleted(attempt.state)) {
            // Attempt is finished, get feedback and review data.
            const attemptGrade = AddonModTabletTabletQuiz.rescaleGrade(attempt.sumgrades, tabletquiz, false);
            const attemptGradeNumber = attemptGrade !== undefined && Number(attemptGrade);
            if (isSafeNumber(attemptGradeNumber)) {
                promises.push(AddonModTabletTabletQuiz.getFeedbackForGrade(tabletquiz.id, attemptGradeNumber, modOptions));
            }

            promises.push(this.prefetchAttemptReview(tabletquiz, accessInfo, attempt, modOptions));
        } else {

            // Attempt not finished, get data needed to continue the attempt.
            promises.push(AddonModTabletTabletQuiz.getAttemptAccessInformation(tabletquiz.id, attempt.id, modOptions));
            promises.push(AddonModTabletTabletQuiz.getAttemptSummary(attempt.id, preflightData, modOptions));

            if (attempt.state === AddonModTabletTabletQuizAttemptStates.IN_PROGRESS) {
                // Get data for each page.
                const pages = AddonModTabletTabletQuiz.getPagesFromLayout(attempt.layout);

                promises = promises.concat(pages.map(async (page) => {
                    if (isSequential && typeof attempt.currentpage === 'number' && page < attempt.currentpage) {
                        // Sequential tabletquiz, cannot get pages before the current one.
                        return;
                    }

                    const data = await AddonModTabletTabletQuiz.getAttemptData(attempt.id, page, preflightData, modOptions);

                    // Download the files inside the questions.
                    await Promise.all(data.questions.map(async (question) => {
                        await CoreQuestionHelper.prefetchQuestionFiles(
                            question,
                            this.component,
                            tabletquiz.coursemodule,
                            siteId,
                            attempt.uniqueid,
                        );
                    }));

                }));
            }
        }

        await Promise.all(promises);
    }

    /**
     * Prefetch attempt review data.
     *
     * @param tabletquiz TabletQuiz.
     * @param accessInfo TabletQuiz access info.
     * @param attempt Attempt.
     * @param modOptions Other options.
     */
    protected async prefetchAttemptReview(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        accessInfo: AddonModTabletTabletQuizGetTabletQuizAccessInformationWSResponse,
        attempt: AddonModTabletTabletQuizAttemptWSData,
        modOptions: CoreCourseCommonModWSOptions,
    ): Promise<void> {
        // Check if attempt can be reviewed.
        const canReview = await AddonModTabletTabletQuizHelper.canReviewAttempt(tabletquiz, accessInfo, attempt);
        if (!canReview) {
            return;
        }

        const pages = AddonModTabletTabletQuiz.getPagesFromLayout(attempt.layout);
        const promises: Promise<unknown>[] = [];

        // Get the review for each page.
        pages.forEach((page) => {
            promises.push(CorePromiseUtils.ignoreErrors(AddonModTabletTabletQuiz.getAttemptReview(attempt.id, {
                page,
                ...modOptions, // Include all options.
            })));
        });

        // Get the review for all questions in same page.
        promises.push(this.prefetchAttemptReviewFiles(tabletquiz, attempt, modOptions));

        await Promise.all(promises);
    }

    /**
     * Prefetch attempt review and its files.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @param modOptions Other options.
     */
    protected async prefetchAttemptReviewFiles(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData,
        modOptions: CoreCourseCommonModWSOptions,
    ): Promise<void> {
        // Get the review for all questions in same page.
        const data = await CorePromiseUtils.ignoreErrors(AddonModTabletTabletQuiz.getAttemptReview(attempt.id, {
            page: -1,
            ...modOptions, // Include all options.
        }));

        if (!data) {
            return;
        }
        // Download the files inside the questions.
        await Promise.all(data.questions.map((question) => {
            CoreQuestionHelper.prefetchQuestionFiles(
                question,
                this.component,
                tabletquiz.coursemodule,
                modOptions.siteId,
                attempt.uniqueid,
            );
        }));
    }

    /**
     * Prefetch tabletquiz grade and its feedback.
     *
     * @param tabletquiz TabletQuiz.
     * @param modOptions Other options.
     * @param siteId Site ID.
     */
    protected async prefetchGradeAndFeedback(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        modOptions: CoreCourseCommonModWSOptions,
        siteId?: string,
    ): Promise<void> {
        try {
            const gradebookData = await AddonModTabletTabletQuiz.getGradeFromGradebook(tabletquiz.course, tabletquiz.coursemodule, true, siteId);

            if (gradebookData && gradebookData.graderaw !== undefined) {
                await AddonModTabletTabletQuiz.getFeedbackForGrade(tabletquiz.id, gradebookData.graderaw, modOptions);
            }
        } catch {
            // Ignore errors.
        }
    }

    /**
     * Prefetches some data for a tabletquiz and its last attempt.
     * This function will NOT start a new attempt, it only reads data for the tabletquiz and the last attempt.
     *
     * @param tabletquiz TabletQuiz.
     * @param askPreflight Whether it should ask for preflight data if needed.
     * @param siteId Site ID. If not defined, current site.
     */
    async prefetchTabletQuizAndLastAttempt(tabletquiz: AddonModTabletTabletQuizTabletQuizWSData, askPreflight?: boolean, siteId?: string): Promise<void> {
        siteId = siteId || CoreSites.getCurrentSiteId();

        const modOptions = {
            cmId: tabletquiz.coursemodule,
            readingStrategy: CoreSitesReadingStrategy.ONLY_NETWORK,
            siteId,
        };

        // Get tabletquiz data.
        const [tabletquizAccessInfo, attempts] = await Promise.all([
            AddonModTabletTabletQuiz.getTabletQuizAccessInformation(tabletquiz.id, modOptions),
            AddonModTabletTabletQuiz.getUserAttempts(tabletquiz.id, modOptions),
            AddonModTabletTabletQuiz.getTabletQuizRequiredQtypes(tabletquiz.id, modOptions),
            AddonModTabletTabletQuiz.getCombinedReviewOptions(tabletquiz.id, modOptions),
            AddonModTabletTabletQuiz.getUserBestGrade(tabletquiz.id, modOptions),
            this.prefetchGradeAndFeedback(tabletquiz, modOptions, siteId),
            AddonModTabletTabletQuiz.getAttemptAccessInformation(tabletquiz.id, 0, modOptions), // Last attempt.
        ]);

        const lastAttempt = attempts[attempts.length - 1];
        let preflightData: Record<string, string> = {};
        if (lastAttempt) {
            // Get the preflight data.
            preflightData = await AddonModTabletTabletQuizHelper.getPreflightDataToAttemptOffline(
                tabletquiz,
                tabletquizAccessInfo,
                lastAttempt,
                askPreflight,
                'core.download',
                siteId,
            );

            // Get data for last attempt.
            await this.prefetchAttempt(tabletquiz, tabletquizAccessInfo, lastAttempt, preflightData, siteId);
        }

        // Prefetch finished, set the right status.
        await this.setStatusAfterPrefetch(tabletquiz, {
            cmId: tabletquiz.coursemodule,
            attempts,
            readingStrategy: CoreSitesReadingStrategy.PREFER_CACHE,
            siteId,
        });
    }

    /**
     * Set the right status to a tabletquiz after prefetching.
     * If the last attempt is finished or there isn't one, set it as not downloaded to show download icon.
     *
     * @param tabletquiz TabletQuiz.
     * @param options Other options.
     */
    async setStatusAfterPrefetch(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        options: AddonModTabletTabletQuizSetStatusAfterPrefetchOptions = {},
    ): Promise<void> {
        options.siteId = options.siteId || CoreSites.getCurrentSiteId();

        let attempts = options.attempts;

        if (!attempts) {
            // Get the attempts.
            attempts = await AddonModTabletTabletQuiz.getUserAttempts(tabletquiz.id, options);
        }

        // Check the current status of the tabletquiz.
        const status = await CoreFilepool.getPackageStatus(options.siteId, this.component, tabletquiz.coursemodule);

        if (status === DownloadStatus.DOWNLOADABLE_NOT_DOWNLOADED) {
            return;
        }

        // TabletQuiz was downloaded, set the new status.
        // If no attempts or last is finished we'll mark it as not downloaded to show download icon.
        const lastAttempt = attempts[attempts.length - 1];
        const isLastCompleted = !lastAttempt || AddonModTabletTabletQuiz.isAttemptCompleted(lastAttempt.state);
        const newStatus = isLastCompleted ? DownloadStatus.DOWNLOADABLE_NOT_DOWNLOADED : DownloadStatus.DOWNLOADED;

        await CoreFilepool.storePackageStatus(options.siteId, newStatus, this.component, tabletquiz.coursemodule);
    }

    /**
     * Sync a module.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to
     * @param siteId Site ID. If not defined, current site.
     * @returns Sync results.
     */
    async sync(module: SyncedModule, courseId: number, siteId?: string): Promise<AddonModTabletTabletQuizSyncResult | undefined> {
        const tabletquiz = await AddonModTabletTabletQuiz.getTabletQuiz(courseId, module.id, { siteId });

        try {
            const result = await AddonModTabletTabletQuizSync.syncTabletQuiz(tabletquiz, false, siteId);

            module.attemptFinished = result.attemptFinished || false;

            return result;
        } catch {
            // Ignore errors.
            module.attemptFinished = false;
        }
    }

}

export const AddonModTabletTabletQuizPrefetchHandler = makeSingleton(AddonModTabletTabletQuizPrefetchHandlerService);

/**
 * Options to pass to setStatusAfterPrefetch.
 */
export type AddonModTabletTabletQuizSetStatusAfterPrefetchOptions = CoreCourseCommonModWSOptions & {
    attempts?: AddonModTabletTabletQuizAttemptWSData[]; // List of attempts. If not provided, they will be calculated.
};

/**
 * Module data with some calculated data.
 */
type SyncedModule = CoreCourseAnyModuleData & {
    attemptFinished?: boolean;
};
