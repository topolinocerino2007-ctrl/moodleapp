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
    AddonModTabletQuiz,
    AddonModTabletQuizAttemptWSData,
    AddonModTabletQuizGetQuizAccessInformationWSResponse,
    AddonModTabletQuizQuizWSData,
} from '../tabletquiz';
import { AddonModTabletQuizHelper } from '../tabletquiz-helper';
import { AddonModTabletQuizSync, AddonModTabletQuizSyncResult } from '../tabletquiz-sync';
import { AddonModTabletQuizAttemptStates, ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, ADDON_MOD_TABLETQUIZ_MODNAME } from '../../constants';

/**
 * Handler to prefetch quizzes.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletQuizPrefetchHandlerService extends CoreCourseActivityPrefetchHandlerBase {

    name = 'AddonModTabletQuiz';
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
            const TabletQuiz = await AddonModTabletQuiz.getQuiz(courseId, module.id);

            const files = this.getIntroFilesFromInstance(module, TabletQuiz);

            const attempts = await AddonModTabletQuiz.getUserAttempts(TabletQuiz.id, {
                cmId: module.id,
                readingStrategy: CoreSitesReadingStrategy.ONLY_NETWORK,
            });

            const attemptFiles = await this.getAttemptsFeedbackFiles(TabletQuiz, attempts);

            return files.concat(attemptFiles);
        } catch {
            // TabletQuiz not found, return empty list.
            return [];
        }
    }

    /**
     * Get the list of downloadable files on feedback attemptss.
     *
     * @param TabletQuiz TabletQuiz.
     * @param attempts TabletQuiz user attempts.
     * @param siteId Site ID. If not defined, current site.
     * @returns List of Files.
     */
    protected async getAttemptsFeedbackFiles(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        attempts: AddonModTabletQuizAttemptWSData[],
        siteId?: string,
    ): Promise<CoreWSFile[]> {
        let files: CoreWSFile[] = [];

        await Promise.all(attempts.map(async (attempt) => {
            if (!AddonModTabletQuiz.isAttemptCompleted(attempt.state)) {
                // Attempt not completed, no feedback files.
                return;
            }

            const attemptGrade = AddonModTabletQuiz.rescaleGrade(attempt.sumgrades, TabletQuiz, false);
            const attemptGradeNumber = attemptGrade !== undefined && Number(attemptGrade);
            if (!isSafeNumber(attemptGradeNumber)) {
                return;
            }

            const feedback = await AddonModTabletQuiz.getFeedbackForGrade(TabletQuiz.id, attemptGradeNumber, {
                cmId: TabletQuiz.coursemodule,
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
        await AddonModTabletQuiz.invalidateContent(moduleId, courseId);
    }

    /**
     * Invalidate WS calls needed to determine module status.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to.
     * @returns Promise resolved when invalidated.
     */
    async invalidateModule(module: CoreCourseAnyModuleData, courseId: number): Promise<void> {
        // Invalidate the calls required to check if a TabletQuiz is downloadable.
        await Promise.all([
            AddonModTabletQuiz.invalidateQuizData(courseId),
            AddonModTabletQuiz.invalidateUserAttemptsForUser(module.instance),
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
            // Don't allow downloading the TabletQuiz if offline is disabled to prevent wasting a lot of data when opening it.
            return false;
        }

        const siteId = CoreSites.getCurrentSiteId();

        const TabletQuiz = await AddonModTabletQuiz.getQuiz(courseId, module.id, { siteId });

        if (!AddonModTabletQuiz.isQuizOffline(TabletQuiz) || TabletQuiz.hasquestions === 0) {
            return false;
        }

        // Not downloadable if we reached max attempts or the TabletQuiz has an unfinished attempt.
        const attempts = await AddonModTabletQuiz.getUserAttempts(TabletQuiz.id, {
            cmId: module.id,
            siteId,
        });

        const isLastCompleted = !attempts.length || AddonModTabletQuiz.isAttemptCompleted(attempts[attempts.length - 1].state);

        return TabletQuiz.attempts === 0 || (TabletQuiz.attempts ?? 0) > attempts.length || !isLastCompleted;
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

        return this.prefetchPackage(module, courseId, (siteId) => this.prefetchQuiz(module, courseId, !!single, canStart, siteId));
    }

    /**
     * Prefetch a TabletQuiz.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to.
     * @param single True if we're downloading a single module, false if we're downloading a whole section.
     * @param canStart If true, start a new attempt if needed.
     * @param siteId Site ID.
     */
    protected async prefetchQuiz(
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

        // Get TabletQuiz.
        const TabletQuiz = await AddonModTabletQuiz.getQuiz(courseId, module.id, commonOptions);

        const introFiles = this.getIntroFilesFromInstance(module, TabletQuiz);

        // Prefetch some TabletQuiz data.
        // eslint-disable-next-line prefer-const
        let [quizAccessInfo, attempts, attemptAccessInfo] = await Promise.all([
            AddonModTabletQuiz.getQuizAccessInformation(TabletQuiz.id, modOptions),
            AddonModTabletQuiz.getUserAttempts(TabletQuiz.id, modOptions),
            AddonModTabletQuiz.getAttemptAccessInformation(TabletQuiz.id, 0, modOptions),
            AddonModTabletQuiz.getQuizRequiredQtypes(TabletQuiz.id, modOptions),
            CoreFilepool.addFilesToQueue(siteId, introFiles, ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, module.id),
        ]);

        // Check if we need to start a new attempt.
        let attempt: AddonModTabletQuizAttemptWSData | undefined = attempts[attempts.length - 1];
        let preflightData: Record<string, string> = {};
        let startAttempt = false;

        if (canStart || attempt) {
            if (canStart && (!attempt || AddonModTabletQuiz.isAttemptCompleted(attempt.state))) {
                // Check if the user can attempt the TabletQuiz.
                if (attemptAccessInfo.preventnewattemptreasons.length) {
                    throw new CoreError(CoreText.buildMessage(attemptAccessInfo.preventnewattemptreasons));
                }

                startAttempt = true;
                attempt = undefined;
            }

            // Get the preflight data. This function will also start a new attempt if needed.
            preflightData =
                await AddonModTabletQuizHelper.getPreflightDataToAttemptOffline(
                    TabletQuiz,
                    quizAccessInfo,
                    attempt,
                    single,
                    'core.download',
                    siteId,
                );
        }

        const promises: Promise<unknown>[] = [];

        if (startAttempt) {
            // Re-fetch user attempts since we created a new one.
            promises.push(AddonModTabletQuiz.getUserAttempts(TabletQuiz.id, modOptions).then(async (atts) => {
                attempts = atts;

                const attemptFiles = await this.getAttemptsFeedbackFiles(TabletQuiz, attempts, siteId);

                return CoreFilepool.addFilesToQueue(siteId, attemptFiles, ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, module.id);
            }));

            // Update the download time to prevent detecting the new attempt as an update.
            promises.push(CorePromiseUtils.ignoreErrors(
                CoreFilepool.updatePackageDownloadTime(siteId, ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, module.id),
            ));
        } else {
            // Use the already fetched attempts.
            promises.push(this.getAttemptsFeedbackFiles(TabletQuiz, attempts, siteId).then((attemptFiles) =>
                CoreFilepool.addFilesToQueue(siteId, attemptFiles, ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, module.id)));
        }

        // Fetch attempt related data.
        promises.push(AddonModTabletQuiz.getCombinedReviewOptions(TabletQuiz.id, modOptions));
        promises.push(AddonModTabletQuiz.getUserBestGrade(TabletQuiz.id, modOptions));
        promises.push(this.prefetchGradeAndFeedback(TabletQuiz, modOptions, siteId));
        promises.push(AddonModTabletQuiz.getAttemptAccessInformation(TabletQuiz.id, 0, modOptions)); // Last attempt.

        // Get course data, needed to determine upload max size if it's configured to be course limit.
        promises.push(CorePromiseUtils.ignoreErrors(CoreCourses.getCourseByField('id', courseId, siteId)));

        await Promise.all(promises);

        // We have TabletQuiz data, now we'll get specific data for each attempt.
        await Promise.all(attempts.map(async (attempt) => {
            await this.prefetchAttempt(TabletQuiz, quizAccessInfo, attempt, preflightData, siteId);
        }));

        if (!canStart) {
            // Nothing else to do.
            return;
        }

        // If there's nothing to send, mark the TabletQuiz as synchronized.
        const hasData = await AddonModTabletQuizSync.hasDataToSync(TabletQuiz.id, siteId);

        if (!hasData) {
            AddonModTabletQuizSync.setSyncTime(TabletQuiz.id, siteId);
        }
    }

    /**
     * Prefetch all WS data for an attempt.
     *
     * @param TabletQuiz TabletQuiz.
     * @param accessInfo TabletQuiz access info.
     * @param attempt Attempt.
     * @param preflightData Preflight required data (like password).
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when the prefetch is finished. Data returned is not reliable.
     */
    async prefetchAttempt(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        accessInfo: AddonModTabletQuizGetQuizAccessInformationWSResponse,
        attempt: AddonModTabletQuizAttemptWSData,
        preflightData: Record<string, string>,
        siteId?: string,
    ): Promise<void> {
        const isSequential = AddonModTabletQuiz.isNavigationSequential(TabletQuiz);
        let promises: Promise<unknown>[] = [];

        const modOptions: CoreCourseCommonModWSOptions = {
            cmId: TabletQuiz.coursemodule,
            readingStrategy: CoreSitesReadingStrategy.ONLY_NETWORK,
            siteId,
        };

        if (AddonModTabletQuiz.isAttemptCompleted(attempt.state)) {
            // Attempt is finished, get feedback and review data.
            const attemptGrade = AddonModTabletQuiz.rescaleGrade(attempt.sumgrades, TabletQuiz, false);
            const attemptGradeNumber = attemptGrade !== undefined && Number(attemptGrade);
            if (isSafeNumber(attemptGradeNumber)) {
                promises.push(AddonModTabletQuiz.getFeedbackForGrade(TabletQuiz.id, attemptGradeNumber, modOptions));
            }

            promises.push(this.prefetchAttemptReview(TabletQuiz, accessInfo, attempt, modOptions));
        } else {

            // Attempt not finished, get data needed to continue the attempt.
            promises.push(AddonModTabletQuiz.getAttemptAccessInformation(TabletQuiz.id, attempt.id, modOptions));
            promises.push(AddonModTabletQuiz.getAttemptSummary(attempt.id, preflightData, modOptions));

            if (attempt.state === AddonModTabletQuizAttemptStates.IN_PROGRESS) {
                // Get data for each page.
                const pages = AddonModTabletQuiz.getPagesFromLayout(attempt.layout);

                promises = promises.concat(pages.map(async (page) => {
                    if (isSequential && typeof attempt.currentpage === 'number' && page < attempt.currentpage) {
                        // Sequential TabletQuiz, cannot get pages before the current one.
                        return;
                    }

                    const data = await AddonModTabletQuiz.getAttemptData(attempt.id, page, preflightData, modOptions);

                    // Download the files inside the questions.
                    await Promise.all(data.questions.map(async (question) => {
                        await CoreQuestionHelper.prefetchQuestionFiles(
                            question,
                            this.component,
                            TabletQuiz.coursemodule,
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
     * @param TabletQuiz TabletQuiz.
     * @param accessInfo TabletQuiz access info.
     * @param attempt Attempt.
     * @param modOptions Other options.
     */
    protected async prefetchAttemptReview(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        accessInfo: AddonModTabletQuizGetQuizAccessInformationWSResponse,
        attempt: AddonModTabletQuizAttemptWSData,
        modOptions: CoreCourseCommonModWSOptions,
    ): Promise<void> {
        // Check if attempt can be reviewed.
        const canReview = await AddonModTabletQuizHelper.canReviewAttempt(TabletQuiz, accessInfo, attempt);
        if (!canReview) {
            return;
        }

        const pages = AddonModTabletQuiz.getPagesFromLayout(attempt.layout);
        const promises: Promise<unknown>[] = [];

        // Get the review for each page.
        pages.forEach((page) => {
            promises.push(CorePromiseUtils.ignoreErrors(AddonModTabletQuiz.getAttemptReview(attempt.id, {
                page,
                ...modOptions, // Include all options.
            })));
        });

        // Get the review for all questions in same page.
        promises.push(this.prefetchAttemptReviewFiles(TabletQuiz, attempt, modOptions));

        await Promise.all(promises);
    }

    /**
     * Prefetch attempt review and its files.
     *
     * @param TabletQuiz TabletQuiz.
     * @param attempt Attempt.
     * @param modOptions Other options.
     */
    protected async prefetchAttemptReviewFiles(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        attempt: AddonModTabletQuizAttemptWSData,
        modOptions: CoreCourseCommonModWSOptions,
    ): Promise<void> {
        // Get the review for all questions in same page.
        const data = await CorePromiseUtils.ignoreErrors(AddonModTabletQuiz.getAttemptReview(attempt.id, {
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
                TabletQuiz.coursemodule,
                modOptions.siteId,
                attempt.uniqueid,
            );
        }));
    }

    /**
     * Prefetch TabletQuiz grade and its feedback.
     *
     * @param TabletQuiz TabletQuiz.
     * @param modOptions Other options.
     * @param siteId Site ID.
     */
    protected async prefetchGradeAndFeedback(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        modOptions: CoreCourseCommonModWSOptions,
        siteId?: string,
    ): Promise<void> {
        try {
            const gradebookData = await AddonModTabletQuiz.getGradeFromGradebook(TabletQuiz.course, TabletQuiz.coursemodule, true, siteId);

            if (gradebookData && gradebookData.graderaw !== undefined) {
                await AddonModTabletQuiz.getFeedbackForGrade(TabletQuiz.id, gradebookData.graderaw, modOptions);
            }
        } catch {
            // Ignore errors.
        }
    }

    /**
     * Prefetches some data for a TabletQuiz and its last attempt.
     * This function will NOT start a new attempt, it only reads data for the TabletQuiz and the last attempt.
     *
     * @param TabletQuiz TabletQuiz.
     * @param askPreflight Whether it should ask for preflight data if needed.
     * @param siteId Site ID. If not defined, current site.
     */
    async prefetchQuizAndLastAttempt(TabletQuiz: AddonModTabletQuizQuizWSData, askPreflight?: boolean, siteId?: string): Promise<void> {
        siteId = siteId || CoreSites.getCurrentSiteId();

        const modOptions = {
            cmId: TabletQuiz.coursemodule,
            readingStrategy: CoreSitesReadingStrategy.ONLY_NETWORK,
            siteId,
        };

        // Get TabletQuiz data.
        const [quizAccessInfo, attempts] = await Promise.all([
            AddonModTabletQuiz.getQuizAccessInformation(TabletQuiz.id, modOptions),
            AddonModTabletQuiz.getUserAttempts(TabletQuiz.id, modOptions),
            AddonModTabletQuiz.getQuizRequiredQtypes(TabletQuiz.id, modOptions),
            AddonModTabletQuiz.getCombinedReviewOptions(TabletQuiz.id, modOptions),
            AddonModTabletQuiz.getUserBestGrade(TabletQuiz.id, modOptions),
            this.prefetchGradeAndFeedback(TabletQuiz, modOptions, siteId),
            AddonModTabletQuiz.getAttemptAccessInformation(TabletQuiz.id, 0, modOptions), // Last attempt.
        ]);

        const lastAttempt = attempts[attempts.length - 1];
        let preflightData: Record<string, string> = {};
        if (lastAttempt) {
            // Get the preflight data.
            preflightData = await AddonModTabletQuizHelper.getPreflightDataToAttemptOffline(
                TabletQuiz,
                quizAccessInfo,
                lastAttempt,
                askPreflight,
                'core.download',
                siteId,
            );

            // Get data for last attempt.
            await this.prefetchAttempt(TabletQuiz, quizAccessInfo, lastAttempt, preflightData, siteId);
        }

        // Prefetch finished, set the right status.
        await this.setStatusAfterPrefetch(TabletQuiz, {
            cmId: TabletQuiz.coursemodule,
            attempts,
            readingStrategy: CoreSitesReadingStrategy.PREFER_CACHE,
            siteId,
        });
    }

    /**
     * Set the right status to a TabletQuiz after prefetching.
     * If the last attempt is finished or there isn't one, set it as not downloaded to show download icon.
     *
     * @param TabletQuiz TabletQuiz.
     * @param options Other options.
     */
    async setStatusAfterPrefetch(
        TabletQuiz: AddonModTabletQuizQuizWSData,
        options: AddonModTabletQuizSetStatusAfterPrefetchOptions = {},
    ): Promise<void> {
        options.siteId = options.siteId || CoreSites.getCurrentSiteId();

        let attempts = options.attempts;

        if (!attempts) {
            // Get the attempts.
            attempts = await AddonModTabletQuiz.getUserAttempts(TabletQuiz.id, options);
        }

        // Check the current status of the TabletQuiz.
        const status = await CoreFilepool.getPackageStatus(options.siteId, this.component, TabletQuiz.coursemodule);

        if (status === DownloadStatus.DOWNLOADABLE_NOT_DOWNLOADED) {
            return;
        }

        // TabletQuiz was downloaded, set the new status.
        // If no attempts or last is finished we'll mark it as not downloaded to show download icon.
        const lastAttempt = attempts[attempts.length - 1];
        const isLastCompleted = !lastAttempt || AddonModTabletQuiz.isAttemptCompleted(lastAttempt.state);
        const newStatus = isLastCompleted ? DownloadStatus.DOWNLOADABLE_NOT_DOWNLOADED : DownloadStatus.DOWNLOADED;

        await CoreFilepool.storePackageStatus(options.siteId, newStatus, this.component, TabletQuiz.coursemodule);
    }

    /**
     * Sync a module.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to
     * @param siteId Site ID. If not defined, current site.
     * @returns Sync results.
     */
    async sync(module: SyncedModule, courseId: number, siteId?: string): Promise<AddonModTabletQuizSyncResult | undefined> {
        const TabletQuiz = await AddonModTabletQuiz.getQuiz(courseId, module.id, { siteId });

        try {
            const result = await AddonModTabletQuizSync.syncQuiz(TabletQuiz, false, siteId);

            module.attemptFinished = result.attemptFinished || false;

            return result;
        } catch {
            // Ignore errors.
            module.attemptFinished = false;
        }
    }

}

export const AddonModTabletQuizPrefetchHandler = makeSingleton(AddonModTabletQuizPrefetchHandlerService);

/**
 * Options to pass to setStatusAfterPrefetch.
 */
export type AddonModTabletQuizSetStatusAfterPrefetchOptions = CoreCourseCommonModWSOptions & {
    attempts?: AddonModTabletQuizAttemptWSData[]; // List of attempts. If not provided, they will be calculated.
};

/**
 * Module data with some calculated data.
 */
type SyncedModule = CoreCourseAnyModuleData & {
    attemptFinished?: boolean;
};

