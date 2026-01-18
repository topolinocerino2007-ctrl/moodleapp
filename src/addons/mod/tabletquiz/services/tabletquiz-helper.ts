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

import { Injectable } from '@angular/core';

import { CoreCanceledError } from '@classes/errors/cancelederror';
import { CoreError } from '@classes/errors/error';
import { CoreCourse } from '@features/course/services/course';
import { CoreNavigator } from '@services/navigator';
import { CoreSites, CoreSitesReadingStrategy } from '@services/sites';
import { CoreDom } from '@singletons/dom';
import { CoreWSError } from '@classes/errors/wserror';
import { makeSingleton, Translate } from '@singletons';
import { AddonModTabletQuizAccessRuleDelegate } from './access-rules-delegate';
import {
    AddonModTabletQuiz,
    AddonModTabletQuizAttemptWSData,
    AddonModTabletQuizCombinedReviewOptions,
    AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
    AddonModTabletQuizTabletQuizWSData,
} from './tabletquiz';
import { AddonModTabletQuizOffline } from './tabletquiz-offline';
import {
    ADDON_MOD_TABLETQUIZ_IMMEDIATELY_AFTER_PERIOD,
    ADDON_MOD_TABLETQUIZ_MODNAME,
    ADDON_MOD_TABLETQUIZ_PAGE_NAME,
    AddonModTabletQuizAttemptStates,
    AddonModTabletQuizDisplayOptionsAttemptStates,
} from '../constants';
import { QuestionDisplayOptionsMarks } from '@features/question/constants';
import { CoreGroups } from '@services/groups';
import { CoreTime } from '@singletons/time';
import { CoreModals } from '@services/overlays/modals';
import { CoreLoadings } from '@services/overlays/loadings';
import { convertTextToHTMLElement } from '@/core/utils/create-html-element';
import { CorePromiseUtils } from '@singletons/promise-utils';
import { CoreAlerts } from '@services/overlays/alerts';

/**
 * Helper service that provides some features for tabletquiz.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletQuizHelperProvider {

    /**
     * Check if current user can review an attempt.
     *
     * @param tabletquiz TabletQuiz.
     * @param accessInfo Access info.
     * @param attempt Attempt.
     * @returns Whether user can review the attempt.
     */
    async canReviewAttempt(
        tabletquiz: AddonModTabletQuizTabletQuizWSData,
        accessInfo: AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
        attempt: AddonModTabletQuizAttemptWSData,
    ): Promise<boolean> {
        if (!this.hasReviewCapabilityForAttempt(tabletquiz, accessInfo, attempt)) {
            return false;
        }

        if (attempt.userid !== CoreSites.getCurrentSiteUserId()) {
            return this.canReviewOtherUserAttempt(tabletquiz, accessInfo, attempt);
        }

        if (!AddonModTabletQuiz.isAttemptCompleted(attempt.state)) {
            // Cannot review own uncompleted attempts.
            return false;
        }

        if (attempt.preview && accessInfo.canpreview) {
            // A teacher can always review their own preview no matter the review options settings.
            return true;
        }

        if (!attempt.preview && accessInfo.canviewreports) {
            // Users who can see reports should be shown everything, except during preview.
            // In LMS, the capability 'moodle/grade:viewhidden' is also checked but the app doesn't have this info.
            return true;
        }

        if (tabletquiz.reviewattempt === undefined) {
            // Workaround for sites where MDL-84360 is not fixed. Allow review, the review WS will throw an error if not allowed.
            return true;
        }

        const options = AddonModTabletQuiz.getDisplayOptionsForTabletQuiz(tabletquiz, AddonModTabletQuiz.getAttemptStateDisplayOption(tabletquiz, attempt));

        return options.attempt;
    }

    /**
     * Check if current user can review another user attempt.
     *
     * @param tabletquiz TabletQuiz.
     * @param accessInfo Access info.
     * @param attempt Attempt.
     * @returns Whether user can review the attempt.
     */
    protected async canReviewOtherUserAttempt(
        tabletquiz: AddonModTabletQuizTabletQuizWSData,
        accessInfo: AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
        attempt: AddonModTabletQuizAttemptWSData,
    ): Promise<boolean> {
        if (!accessInfo.canviewreports) {
            return false;
        }

        try {
            const groupInfo = await CoreGroups.getActivityGroupInfo(tabletquiz.coursemodule);
            if (groupInfo.canAccessAllGroups || !groupInfo.separateGroups) {
                return true;
            }

            // Check if the current user and the attempt's user share any group.
            if (!groupInfo.groups.length) {
                return false;
            }

            const attemptUserGroups = await CoreGroups.getUserGroupsInCourse(tabletquiz.course, undefined, attempt.userid);

            return attemptUserGroups.some(attemptUserGroup => groupInfo.groups.find(group => attemptUserGroup.id === group.id));
        } catch {
            return false;
        }
    }

    /**
     * Get cannot review message.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @param short Whether to use a short message or not.
     * @returns Cannot review message, or empty string if no message to display.
     */
    getCannotReviewMessage(tabletquiz: AddonModTabletQuizTabletQuizWSData, attempt: AddonModTabletQuizAttemptWSData, short = false): string {
        const displayOption = AddonModTabletQuiz.getAttemptStateDisplayOption(tabletquiz, attempt);

        let reviewFrom = 0;
        switch (displayOption) {
            case AddonModTabletQuizDisplayOptionsAttemptStates.DURING:
                return '';

            case AddonModTabletQuizDisplayOptionsAttemptStates.IMMEDIATELY_AFTER:
                // eslint-disable-next-line no-bitwise
                if ((tabletquiz.reviewattempt ?? 0) & AddonModTabletQuizDisplayOptionsAttemptStates.LATER_WHILE_OPEN) {
                    reviewFrom = (attempt.timefinish ?? Date.now()) + ADDON_MOD_TABLETQUIZ_IMMEDIATELY_AFTER_PERIOD;
                    break;
                }
                // Fall through.

            case AddonModTabletQuizDisplayOptionsAttemptStates.LATER_WHILE_OPEN:
                // eslint-disable-next-line no-bitwise
                if (tabletquiz.timeclose && ((tabletquiz.reviewattempt ?? 0) & AddonModTabletQuizDisplayOptionsAttemptStates.AFTER_CLOSE)) {
                    reviewFrom = tabletquiz.timeclose;
                    break;
                }
        }

        if (reviewFrom) {
            return Translate.instant(`addon.mod_tabletquiz.noreviewuntil${short ? 'short' : ''}`, {
                $a: CoreTime.userDate(reviewFrom * 1000, short ? 'core.strftimedatetimeshort': undefined),
            });
        } else {
            return Translate.instant('addon.mod_tabletquiz.noreviewattempt');
        }
    }

    /**
     * Validate a preflight data or show a modal to input the preflight data if required.
     * It calls AddonModTabletQuizProvider.startAttempt if a new attempt is needed.
     *
     * @param tabletquiz TabletQuiz.
     * @param accessInfo TabletQuiz access info.
     * @param preflightData Object where to store the preflight data.
     * @param options Options.
     * @returns Promise resolved when the preflight data is validated. The resolve param is the attempt.
     */
    async getAndCheckPreflightData(
        tabletquiz: AddonModTabletQuizTabletQuizWSData,
        accessInfo: AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
        preflightData: Record<string, string>,
        options: GetAndCheckPreflightOptions = {},
    ): Promise<AddonModTabletQuizAttemptWSData> {

        const rules = accessInfo?.activerulenames;

        // Check if the user needs to input preflight data.
        const preflightCheckRequired = await AddonModTabletQuizAccessRuleDelegate.isPreflightCheckRequired(
            rules,
            tabletquiz,
            options.attempt,
            options.prefetch,
            options.siteId,
        );

        if (preflightCheckRequired) {
            // Preflight check is required. Show a modal with the preflight form.
            const data = await this.getPreflightData(tabletquiz, accessInfo, options);

            // Data entered by the user, add it to preflight data and check it again.
            Object.assign(preflightData, data);
        }

        // Get some fixed preflight data from access rules (data that doesn't require user interaction).
        await AddonModTabletQuizAccessRuleDelegate.getFixedPreflightData(
            rules,
            tabletquiz,
            preflightData,
            options.attempt,
            options.prefetch,
            options.siteId,
        );

        try {
            // All the preflight data is gathered, now validate it.
            return await this.validatePreflightData(tabletquiz, accessInfo, preflightData, options);
        } catch (error) {

            if (options.prefetch) {
                throw error;
            } else if (options.retrying && !preflightCheckRequired) {
                // We're retrying after a failure, but the preflight check wasn't required.
                // This means there's something wrong with some access rule or user is offline and data isn't cached.
                // Don't retry again because it would lead to an infinite loop.
                throw error;
            }

            // Show error and ask for the preflight again.
            // Wait to show the error because we want it to be shown over the preflight modal.
            setTimeout(() => {
                CoreAlerts.showError(error, { default: Translate.instant('core.error') });
            }, 100);

            return this.getAndCheckPreflightData(tabletquiz, accessInfo, preflightData, {
                ...options,
                retrying: true,
            });
        }
    }

    /**
     * Get the preflight data from the user using a modal.
     *
     * @param tabletquiz TabletQuiz.
     * @param accessInfo TabletQuiz access info.
     * @param options Options.
     * @returns Promise resolved with the preflight data. Rejected if user cancels.
     */
    async getPreflightData(
        tabletquiz: AddonModTabletQuizTabletQuizWSData,
        accessInfo: AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
        options: GetPreflightOptions = {},
    ): Promise<Record<string, string>> {
        const notSupported: string[] = [];
        const rules = accessInfo?.activerulenames;

        // Check if there is any unsupported rule.
        rules.forEach((rule) => {
            if (!AddonModTabletQuizAccessRuleDelegate.isAccessRuleSupported(rule)) {
                notSupported.push(rule);
            }
        });

        if (notSupported.length) {
            throw new CoreError(
                Translate.instant('addon.mod_tabletquiz.errorrulesnotsupported') + ' ' + JSON.stringify(notSupported),
            );
        }

        const { AddonModTabletQuizPreflightModalComponent } =
            await import('@addons/mod/tabletquiz/components/preflight-modal/preflight-modal');

        // Create and show the modal.
        const modalData = await CoreModals.openModal<Record<string, string>>({
            component: AddonModTabletQuizPreflightModalComponent,
            componentProps: {
                title: options.title,
                tabletquiz,
                attempt: options.attempt,
                prefetch: !!options.prefetch,
                siteId: options.siteId,
                rules: rules,
            },
        });

        if (!modalData) {
            throw new CoreCanceledError();
        }

        return modalData;
    }

    /**
     * Gets the mark string from a question HTML.
     * Example result: "Marked out of 1.00".
     *
     * @param html Question's HTML.
     * @returns Question's mark.
     */
    getQuestionMarkFromHtml(html: string): string | undefined {
        const element = convertTextToHTMLElement(html);

        return CoreDom.getContentsOfElement(element, '.grade');
    }

    /**
     * Get a tabletquiz ID by attempt ID.
     *
     * @param attemptId Attempt ID.
     * @param options Other options.
     * @returns Promise resolved with the tabletquiz ID.
     */
    async getTabletQuizIdByAttemptId(attemptId: number, options: { cmId?: number; siteId?: string } = {}): Promise<number> {
        // Use getAttemptReview to retrieve the tabletquiz ID.
        const reviewData = await AddonModTabletQuiz.getAttemptReview(attemptId, options);

        if (reviewData.attempt.tabletquiz) {
            return reviewData.attempt.tabletquiz;
        }

        throw new CoreError('Cannot get tabletquiz ID.');
    }

    /**
     * Handle a review link.
     *
     * @param attemptId Attempt ID.
     * @param page Page to load, -1 to all questions in same page.
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    async handleReviewLink(attemptId: number, page?: number, tabletquizId?: number, siteId?: string): Promise<void> {
        siteId = siteId || CoreSites.getCurrentSiteId();

        const modal = await CoreLoadings.show();

        try {
            if (!tabletquizId) {
                tabletquizId = await this.getTabletQuizIdByAttemptId(attemptId, { siteId });
            }

            const module = await CoreCourse.getModuleBasicInfoByInstance(
                tabletquizId,
                ADDON_MOD_TABLETQUIZ_MODNAME,
                { siteId, readingStrategy: CoreSitesReadingStrategy.PREFER_CACHE },
            );

            // Go to the review page.
            await CoreNavigator.navigateToSitePath(
                `${ADDON_MOD_TABLETQUIZ_PAGE_NAME}/${module.course}/${module.id}/review/${attemptId}`,
                {
                    params: {
                        page: page == undefined || isNaN(page) ? -1 : page,
                    },
                    siteId,
                },
            );
        } catch (error) {
            CoreAlerts.showError(error, { default: 'An error occurred while loading the required data.' });
        } finally {
            modal.dismiss();
        }
    }

    /**
     * Check if current user has the necessary capabilities to review an attempt.
     *
     * @param tabletquiz TabletQuiz.
     * @param accessInfo Access info.
     * @param attempt Attempt.
     * @returns Whether user has the capability.
     */
    hasReviewCapabilityForAttempt(
        tabletquiz: AddonModTabletQuizTabletQuizWSData,
        accessInfo: AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
        attempt: AddonModTabletQuizAttemptWSData,
    ): boolean {
        if (accessInfo.canviewreports || accessInfo.canpreview) {
            return true;
        }

        const displayOption = AddonModTabletQuiz.getAttemptStateDisplayOption(tabletquiz, attempt);

        return displayOption === AddonModTabletQuizDisplayOptionsAttemptStates.IMMEDIATELY_AFTER ?
            accessInfo.canattempt : accessInfo.canreviewmyattempts;
    }

    /**
     * Add some calculated data to the attempt.
     *
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @param siteId Site ID.
     * @returns TabletQuiz attempt with calculated data.
     */
    async setAttemptCalculatedData(
        tabletquiz: AddonModTabletQuizTabletQuizData,
        attempt: AddonModTabletQuizAttemptWSData,
        siteId?: string,
    ): Promise<AddonModTabletQuizAttempt> {
        const formattedAttempt = <AddonModTabletQuizAttempt> attempt;

        formattedAttempt.finished = attempt.state === AddonModTabletQuizAttemptStates.FINISHED;
        formattedAttempt.completed = AddonModTabletQuiz.isAttemptCompleted(attempt.state);
        formattedAttempt.rescaledGrade = Number(AddonModTabletQuiz.rescaleGrade(attempt.sumgrades, tabletquiz, false));

        if (tabletquiz.showAttemptsGrades && formattedAttempt.finished) {
            formattedAttempt.formattedGrade = AddonModTabletQuiz.formatGrade(formattedAttempt.rescaledGrade, tabletquiz.decimalpoints);
        } else {
            formattedAttempt.formattedGrade = '';
        }

        formattedAttempt.finishedOffline = await AddonModTabletQuiz.isAttemptFinishedOffline(attempt.id, siteId);

        return formattedAttempt;
    }

    /**
     * Add some calculated data to the tabletquiz.
     *
     * @param tabletquiz TabletQuiz.
     * @param options Review options.
     * @returns TabletQuiz data with some calculated more.
     */
    setTabletQuizCalculatedData(tabletquiz: AddonModTabletQuizTabletQuizWSData, options: AddonModTabletQuizCombinedReviewOptions): AddonModTabletQuizTabletQuizData {
        const formattedTabletQuiz = <AddonModTabletQuizTabletQuizData> tabletquiz;

        formattedTabletQuiz.sumGradesFormatted = AddonModTabletQuiz.formatGrade(tabletquiz.sumgrades, tabletquiz.decimalpoints);
        formattedTabletQuiz.gradeFormatted = AddonModTabletQuiz.formatGrade(tabletquiz.grade, tabletquiz.decimalpoints);

        formattedTabletQuiz.showAttemptsGrades = options.someoptions.marks >= QuestionDisplayOptionsMarks.MARK_AND_MAX &&
            AddonModTabletQuiz.tabletquizHasGrades(tabletquiz);
        formattedTabletQuiz.showAttemptsMarks = formattedTabletQuiz.showAttemptsGrades && tabletquiz.grade !== tabletquiz.sumgrades;
        formattedTabletQuiz.showFeedback = !!tabletquiz.hasfeedback && !!options.alloptions.overallfeedback;

        return formattedTabletQuiz;
    }

    /**
     * Validate the preflight data. It calls AddonModTabletQuizProvider.startAttempt if a new attempt is needed.
     *
     * @param tabletquiz TabletQuiz.
     * @param accessInfo TabletQuiz access info.
     * @param preflightData Object where to store the preflight data.
     * @param options Options
     * @returns Promise resolved when the preflight data is validated.
     */
    async validatePreflightData(
        tabletquiz: AddonModTabletQuizTabletQuizWSData,
        accessInfo: AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
        preflightData: Record<string, string>,
        options: ValidatePreflightOptions = {},
    ): Promise<AddonModTabletQuizAttempt> {

        const rules = accessInfo.activerulenames;
        const modOptions = {
            cmId: tabletquiz.coursemodule,
            readingStrategy: options.offline ? CoreSitesReadingStrategy.PREFER_CACHE : CoreSitesReadingStrategy.ONLY_NETWORK,
            siteId: options.siteId,
        };
        let attempt = options.attempt;

        try {

            if (attempt) {
                if (attempt.state !== AddonModTabletQuizAttemptStates.OVERDUE && !options.finishedOffline) {
                    // We're continuing an attempt. Call getAttemptData to validate the preflight data.
                    await AddonModTabletQuiz.getAttemptData(attempt.id, attempt.currentpage ?? 0, preflightData, modOptions);

                    if (options.offline) {
                        // Get current page stored in local.
                        const storedAttempt = await CorePromiseUtils.ignoreErrors(
                            AddonModTabletQuizOffline.getAttemptById(attempt.id),
                        );

                        attempt.currentpage = storedAttempt?.currentpage ?? attempt.currentpage;
                    }
                } else {
                    // Attempt is overdue or finished in offline, we can only see the summary.
                    // Call getAttemptSummary to validate the preflight data.
                    await AddonModTabletQuiz.getAttemptSummary(attempt.id, preflightData, modOptions);
                }
            } else {
                // We're starting a new attempt, call startAttempt.
                attempt = await AddonModTabletQuiz.startAttempt(tabletquiz.id, preflightData, false, options.siteId);
            }

            // Preflight data validated.
            AddonModTabletQuizAccessRuleDelegate.notifyPreflightCheckPassed(
                rules,
                tabletquiz,
                attempt,
                preflightData,
                options.prefetch,
                options.siteId,
            );

            return attempt;
        } catch (error) {
            if (CoreWSError.isWebServiceError(error)) {
                // The WebService returned an error, assume the preflight failed.
                AddonModTabletQuizAccessRuleDelegate.notifyPreflightCheckFailed(
                    rules,
                    tabletquiz,
                    attempt,
                    preflightData,
                    options.prefetch,
                    options.siteId,
                );
            }

            throw error;
        }
    }

    /**
     * Gather some preflight data for an attempt. This function will start a new attempt if needed.
     *
     * @param tabletquiz TabletQuiz.
     * @param accessInfo TabletQuiz access info returned by AddonModTabletQuizProvider.getTabletQuizAccessInformation.
     * @param attempt Attempt to continue. Don't pass any value if the user needs to start a new attempt.
     * @param askPreflight Whether it should ask for preflight data if needed.
     * @param title Lang key of the title to set to preflight modal (e.g. 'addon.mod_tabletquiz.startattempt').
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with the preflight data.
     */
    async getPreflightDataToAttemptOffline(
        tabletquiz: AddonModTabletQuizTabletQuizWSData,
        accessInfo: AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
        attempt?: AddonModTabletQuizAttemptWSData,
        askPreflight?: boolean,
        title?: string,
        siteId?: string,
    ): Promise<Record<string, string>> {
        const preflightData: Record<string, string> = {};

        if (askPreflight) {
            // We can ask preflight, check if it's needed and get the data.
            await AddonModTabletQuizHelper.getAndCheckPreflightData(
                tabletquiz,
                accessInfo,
                preflightData,
                {
                    attempt,
                    prefetch: true,
                    title,
                    siteId,
                },
            );
        } else {
            // Get some fixed preflight data from access rules (data that doesn't require user interaction).
            const rules = accessInfo?.activerulenames || [];

            await AddonModTabletQuizAccessRuleDelegate.getFixedPreflightData(rules, tabletquiz, preflightData, attempt, true, siteId);

            if (!attempt) {
                // We need to create a new attempt.
                await AddonModTabletQuiz.startAttempt(tabletquiz.id, preflightData, false, siteId);
            }
        }

        return preflightData;
    }

}

export const AddonModTabletQuizHelper = makeSingleton(AddonModTabletQuizHelperProvider);

/**
 * TabletQuiz data with calculated data.
 */
export type AddonModTabletQuizTabletQuizData = AddonModTabletQuizTabletQuizWSData & {
    sumGradesFormatted?: string;
    gradeFormatted?: string;
    showAttemptsGrades?: boolean;
    showAttemptsMarks?: boolean;
    showFeedback?: boolean;
};

/**
 * Attempt data with calculated data.
 */
export type AddonModTabletQuizAttempt = AddonModTabletQuizAttemptWSData & {
    finishedOffline?: boolean;
    rescaledGrade?: number;
    finished?: boolean;
    completed?: boolean;
    formattedGrade?: string;
};

/**
 * Options to validate preflight data.
 */
type ValidatePreflightOptions = {
    attempt?: AddonModTabletQuizAttemptWSData; // Attempt to continue. Don't pass any value if the user needs to start a new attempt.
    offline?: boolean; // Whether the attempt is offline.
    finishedOffline?: boolean; // Whether the attempt is finished offline.
    prefetch?: boolean; // Whether user is prefetching.
    siteId?: string; // Site ID. If not defined, current site.
};

/**
 * Options to check preflight data.
 */
type GetAndCheckPreflightOptions = ValidatePreflightOptions & {
    title?: string; // The title to display in the modal and in the submit button.
    retrying?: boolean; // Whether we're retrying after a failure.
};

/**
 * Options to get preflight data.
 */
type GetPreflightOptions = Omit<GetAndCheckPreflightOptions, 'offline'|'finishedOffline'|'retrying'>;
