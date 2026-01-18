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
import { isSafeNumber, safeNumber, SafeNumber } from '@/core/utils/types';
import { Component, OnDestroy, OnInit } from '@angular/core';

import { CoreCourseModuleMainActivityComponent } from '@features/course/classes/main-activity-component';
import { CoreQuestionBehaviourDelegate } from '@features/question/services/behaviour-delegate';
import { CoreNavigator } from '@services/navigator';
import { CoreText } from '@singletons/text';
import { CorePromiseUtils } from '@singletons/promise-utils';
import { Translate } from '@singletons';
import { CoreEventObserver, CoreEvents } from '@singletons/events';
import { AddonModTabletQuizPrefetchHandler } from '../../services/handlers/prefetch';
import {
    AddonModTabletQuiz,
    AddonModTabletQuizAttemptFinishedData,
    AddonModTabletQuizAttemptWSData,
    AddonModTabletQuizCombinedReviewOptions,
    AddonModTabletQuizGetAttemptAccessInformationWSResponse,
    AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
    AddonModTabletQuizGetUserBestGradeWSResponse,
    AddonModTabletQuizWSAdditionalData,
} from '../../services/tabletquiz';
import { AddonModTabletQuizAttempt, AddonModTabletQuizHelper, AddonModTabletQuizTabletQuizData } from '../../services/tabletquiz-helper';
import {
    AddonModTabletQuizAutoSyncData,
    AddonModTabletQuizSync,
    AddonModTabletQuizSyncResult,
} from '../../services/tabletquiz-sync';
import {
    ADDON_MOD_TABLETQUIZ_ATTEMPT_FINISHED_EVENT,
    ADDON_MOD_TABLETQUIZ_AUTO_SYNCED,
    ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY,
    ADDON_MOD_TABLETQUIZ_PAGE_NAME,
    AddonModTabletQuizAttemptStates,
} from '../../constants';
import { QuestionDisplayOptionsMarks } from '@features/question/constants';
import { CoreAlerts } from '@services/overlays/alerts';
import { AddonModTabletQuizAttemptInfoComponent } from '../attempt-info/attempt-info';
import { AddonModTabletQuizAttemptStateComponent } from '../attempt-state/attempt-state';
import { CoreCourseModuleNavigationComponent } from '@features/course/components/module-navigation/module-navigation';
import { CoreCourseModuleInfoComponent } from '@features/course/components/module-info/module-info';
import { CoreSharedModule } from '@/core/shared.module';

/**
 * Component that displays a tabletquiz entry page.
 */
@Component({
    selector: 'addon-mod-tabletquiz-index',
    templateUrl: 'addon-mod-tabletquiz-index.html',
    styleUrl: 'index.scss',
    imports: [
        CoreSharedModule,
        CoreCourseModuleInfoComponent,
        CoreCourseModuleNavigationComponent,
        AddonModTabletQuizAttemptStateComponent,
        AddonModTabletQuizAttemptInfoComponent,
    ],
})
export class AddonModTabletQuizIndexComponent extends CoreCourseModuleMainActivityComponent implements OnInit, OnDestroy {

    component = ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY;
    pluginName = 'tabletquiz';
    tabletquiz?: AddonModTabletQuizTabletQuizData; // The tabletquiz.
    now?: number; // Current time.
    syncTime?: string; // Last synchronization time.
    hasOffline = false; // Whether the tabletquiz has offline data.
    hasSupportedQuestions = false; // Whether the tabletquiz has at least 1 supported question.
    accessRules: string[] = []; // List of access rules of the tabletquiz.
    unsupportedRules: string[] = []; // List of unsupported access rules of the tabletquiz.
    unsupportedQuestions: string[] = []; // List of unsupported question types of the tabletquiz.
    behaviourSupported = false; // Whether the tabletquiz behaviour is supported.
    showResults = false; // Whether to show the result of the tabletquiz (grade, etc.).
    gradeOverridden = false; // Whether grade has been overridden.
    gradebookFeedback?: string; // The feedback in the gradebook.
    gradeResult?: string; // Message with the grade.
    overallFeedback?: string; // The feedback for the grade.
    buttonText?: string; // Text to display in the start/continue button.
    preventMessages: string[] = []; // List of messages explaining why the tabletquiz cannot be attempted.
    preventMessagesColor = 'danger'; // Color for the prevent messages.
    showStatusSpinner = true; // Whether to show a spinner due to tabletquiz status.
    gradeMethodReadable?: string; // Grade method in a readable format.
    showReviewColumn = false; // Whether to show the review column.
    attempts: TabletQuizAttempt[] = []; // List of attempts the user has made.
    bestGrade?: AddonModTabletQuizGetUserBestGradeWSResponse; // Best grade data.
    gradeToPass?: string; // Grade to pass.
    hasQuestions = false; // Whether the tabletquiz has questions.

    protected fetchContentDefaultError = 'addon.mod_tabletquiz.errorgettabletquiz'; // Default error to show when loading contents.
    protected syncEventName = ADDON_MOD_TABLETQUIZ_AUTO_SYNCED;

    protected autoReview?: AddonModTabletQuizAttemptFinishedData; // Data to auto-review an attempt after finishing.
    protected tabletquizAccessInfo?: AddonModTabletQuizGetTabletQuizAccessInformationWSResponse; // TabletQuiz access info.
    protected attemptAccessInfo?: AddonModTabletQuizGetAttemptAccessInformationWSResponse; // Last attempt access info.
    protected moreAttempts = false; // Whether user can create/continue attempts.
    protected options?: AddonModTabletQuizCombinedReviewOptions; // Combined review options.
    protected gradebookData?: { grade?: SafeNumber; feedback?: string }; // The gradebook grade and feedback.
    protected overallStats = false; // Equivalent to overallstats in mod_tabletquiz_view_object in Moodle.
    protected finishedObserver?: CoreEventObserver; // It will observe attempt finished events.
    protected hasPlayed = false; // Whether the user has gone to the tabletquiz player (attempted).
    protected candidateTabletQuiz?: AddonModTabletQuizTabletQuizData;

    /**
     * @inheritdoc
     */
    async ngOnInit(): Promise<void> {
        super.ngOnInit();

        // Listen for attempt finished events.
        this.finishedObserver = CoreEvents.on(
            ADDON_MOD_TABLETQUIZ_ATTEMPT_FINISHED_EVENT,
            (data) => {
                // Go to review attempt if an attempt in this tabletquiz was finished and synced.
                if (this.tabletquiz && data.tabletquizId == this.tabletquiz.id) {
                    this.autoReview = data;
                }
            },
            this.siteId,
        );

        await this.loadContent(false, true);
    }

    /**
     * Attempt the tabletquiz.
     */
    async attemptTabletQuiz(): Promise<void> {
        if (this.showStatusSpinner || !this.tabletquiz) {
            // TabletQuiz is being downloaded or synchronized, abort.
            return;
        }

        if (!AddonModTabletQuiz.isTabletQuizOffline(this.tabletquiz)) {
            // TabletQuiz isn't offline, just open it.
            this.openTabletQuiz();

            return;
        }

        // TabletQuiz supports offline, check if it needs to be downloaded.
        // If the site doesn't support check updates, always prefetch it because we cannot tell if there's something new.
        const isDownloaded = this.currentStatus === DownloadStatus.DOWNLOADED;

        if (isDownloaded) {
            // Already downloaded, open it.
            this.openTabletQuiz();

            return;
        }

        // Prefetch the tabletquiz.
        this.showStatusSpinner = true;

        try {
            await AddonModTabletQuizPrefetchHandler.prefetch(this.module, this.courseId, true);

            // Success downloading, open tabletquiz.
            this.openTabletQuiz();
        } catch (error) {
            if (this.hasOffline) {
                // Error downloading but there is something offline, allow continuing it.
                // If the site doesn't support check updates, continue too because we cannot tell if there's something new.
                this.openTabletQuiz();
            } else {
                CoreAlerts.showError(error, { default: Translate.instant('core.errordownloading') });
            }
        } finally {
            this.showStatusSpinner = false;
        }
    }

    /**
     * @inheritdoc
     */
    protected async fetchContent(refresh?: boolean, sync = false, showErrors = false): Promise<void> {
        // First get the tabletquiz instance.
        const tabletquiz = await AddonModTabletQuiz.getTabletQuiz(this.courseId, this.module.id);

        this.gradeMethodReadable = AddonModTabletQuiz.getTabletQuizGradeMethod(tabletquiz.grademethod);
        this.now = Date.now();
        this.dataRetrieved.emit(tabletquiz);
        this.description = tabletquiz.intro || this.description;
        this.candidateTabletQuiz = tabletquiz;

        // Try to get warnings from automatic sync.
        const warnings = await AddonModTabletQuizSync.getSyncWarnings(tabletquiz.id);

        if (warnings?.length) {
            // Show warnings and delete them so they aren't shown again.
            CoreAlerts.showError(CoreText.buildMessage(warnings));

            await AddonModTabletQuizSync.setSyncWarnings(tabletquiz.id, []);
        }

        if (AddonModTabletQuiz.isTabletQuizOffline(tabletquiz)) {
            if (sync) {
                // Try to sync the tabletquiz.
                await CorePromiseUtils.ignoreErrors(this.syncActivity(showErrors));
            }
        } else {
            this.showStatusSpinner = false;
        }

        if (AddonModTabletQuiz.isTabletQuizOffline(tabletquiz)) {
            // Handle status.
            this.setStatusListener();

            // Get last synchronization time and check if sync button should be seen.
            this.syncTime = await AddonModTabletQuizSync.getReadableSyncTime(tabletquiz.id);
            this.hasOffline = await AddonModTabletQuizSync.hasDataToSync(tabletquiz.id);
        }

        // Get tabletquiz access info.
        this.tabletquizAccessInfo = await AddonModTabletQuiz.getTabletQuizAccessInformation(tabletquiz.id, { cmId: this.module.id });

        this.showReviewColumn = this.tabletquizAccessInfo.canreviewmyattempts;
        this.accessRules = this.tabletquizAccessInfo.accessrules;
        this.unsupportedRules = AddonModTabletQuiz.getUnsupportedRules(this.tabletquizAccessInfo.activerulenames);

        if (tabletquiz.preferredbehaviour) {
            this.behaviourSupported = CoreQuestionBehaviourDelegate.isBehaviourSupported(tabletquiz.preferredbehaviour);
        }

        // Get question types in the tabletquiz.
        const types = await AddonModTabletQuiz.getTabletQuizRequiredQtypes(tabletquiz.id, { cmId: this.module.id });

        // For closed tabletquizzes we don't receive the hasquestions value (to be fixed in MDL-84360), so we need to check the types.
        this.hasQuestions = tabletquiz.hasquestions !== undefined ? tabletquiz.hasquestions !== 0 : types.length > 0;
        this.unsupportedQuestions = AddonModTabletQuiz.getUnsupportedQuestions(types);
        this.hasSupportedQuestions = !!types.find((type) => type != 'random' && this.unsupportedQuestions.indexOf(type) == -1);

        await this.getAttempts(tabletquiz, this.tabletquizAccessInfo);

        // TabletQuiz is ready to be shown, move it to the variable that is displayed.
        this.tabletquiz = tabletquiz;
    }

    /**
     * Get the user attempts in the tabletquiz and the result info.
     *
     * @param tabletquiz TabletQuiz instance.
     */
    protected async getAttempts(
        tabletquiz: AddonModTabletQuizTabletQuizData,
        accessInfo: AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
    ): Promise<void> {
        // Always get the best grade because it includes the grade to pass.
        this.bestGrade = await AddonModTabletQuiz.getUserBestGrade(tabletquiz.id, { cmId: this.module.id });

        if (typeof this.bestGrade.gradetopass === 'number') {
            this.gradeToPass = AddonModTabletQuiz.formatGrade(this.bestGrade.gradetopass, tabletquiz.decimalpoints);
        }

        // Get access information of last attempt (it also works if no attempts made).
        this.attemptAccessInfo = await AddonModTabletQuiz.getAttemptAccessInformation(tabletquiz.id, 0, { cmId: this.module.id });

        // Get attempts.
        const attempts = await AddonModTabletQuiz.getUserAttempts(tabletquiz.id, { cmId: this.module.id });

        this.attempts = await this.treatAttempts(tabletquiz, accessInfo, attempts);

        // Check if user can create/continue attempts.
        if (this.attempts.length) {
            const last = this.attempts[0];
            this.moreAttempts = !AddonModTabletQuiz.isAttemptCompleted(last.state) || !this.attemptAccessInfo.isfinished;
        } else {
            this.moreAttempts = !this.attemptAccessInfo.isfinished;
        }

        this.getButtonText();

        await this.getResultInfo(tabletquiz);
    }

    /**
     * Get the text to show in the button. It also sets restriction messages if needed.
     */
    protected getButtonText(): void {
        const canOnlyPreview = !!this.tabletquizAccessInfo?.canpreview && !this.tabletquizAccessInfo?.canattempt;
        this.buttonText = '';
        this.preventMessagesColor = canOnlyPreview ? 'warning' : 'danger';

        if (this.hasQuestions) {
            if (this.attempts.length && !AddonModTabletQuiz.isAttemptCompleted(this.attempts[0].state)) {
                // Last attempt is unfinished.
                if (this.tabletquizAccessInfo?.canattempt) {
                    this.buttonText = 'addon.mod_tabletquiz.continueattempttabletquiz';
                } else if (this.tabletquizAccessInfo?.canpreview) {
                    this.buttonText = 'addon.mod_tabletquiz.continuepreview';
                }

            } else {
                // Last attempt is finished or no attempts.
                if (this.tabletquizAccessInfo?.canattempt) {
                    this.preventMessages = this.attemptAccessInfo?.preventnewattemptreasons || [];
                    if (!this.preventMessages.length) {
                        if (!this.attempts.length) {
                            this.buttonText = 'addon.mod_tabletquiz.attempttabletquiznow';
                        } else {
                            this.buttonText = 'addon.mod_tabletquiz.reattempttabletquiz';
                        }
                    }
                } else if (this.tabletquizAccessInfo?.canpreview) {
                    this.buttonText = 'addon.mod_tabletquiz.previewtabletquiznow';
                }
            }
        }

        if (!this.buttonText) {
            return;
        }

        // So far we think a button should be printed, check if they will be allowed to access it.
        this.preventMessages = this.tabletquizAccessInfo?.preventaccessreasons || [];

        if (!this.moreAttempts && !canOnlyPreview) {
            this.buttonText = '';
        } else if (this.tabletquizAccessInfo?.canattempt && this.preventMessages.length) {
            this.buttonText = '';
        } else if (!this.hasSupportedQuestions || this.unsupportedRules.length || !this.behaviourSupported) {
            this.buttonText = '';
        }
    }

    /**
     * Get result info to show.
     *
     * @param tabletquiz TabletQuiz.
     */
    protected async getResultInfo(tabletquiz: AddonModTabletQuizTabletQuizData): Promise<void> {
        if (!this.attempts.length || !tabletquiz.showAttemptsGrades || !this.bestGrade?.hasgrade ||
            this.gradebookData?.grade === undefined) {
            this.showResults = false;

            return;
        }

        const bestGrade = this.bestGrade.grade;
        const formattedGradebookGrade = AddonModTabletQuiz.formatGrade(this.gradebookData.grade, tabletquiz.decimalpoints);
        const formattedBestGrade = AddonModTabletQuiz.formatGrade(bestGrade, tabletquiz.decimalpoints);
        let gradeToShow = formattedGradebookGrade; // By default we show the grade in the gradebook.

        this.showResults = true;
        this.gradeOverridden = formattedGradebookGrade != formattedBestGrade;
        this.gradebookFeedback = this.gradebookData.feedback;

        if (bestGrade && bestGrade > this.gradebookData.grade && this.gradebookData.grade == tabletquiz.grade) {
            // The best grade is higher than the max grade for the tabletquiz.
            // We'll do like Moodle web and show the best grade instead of the gradebook grade.
            this.gradeOverridden = false;
            gradeToShow = formattedBestGrade;
        }

        this.gradeResult = Translate.instant('core.grades.gradelong', { $a: {
            grade: gradeToShow,
            max: tabletquiz.gradeFormatted,
        } });

        if (tabletquiz.showFeedback) {
            // Get the tabletquiz overall feedback.
            const response = await AddonModTabletQuiz.getFeedbackForGrade(tabletquiz.id, this.gradebookData.grade, {
                cmId: this.module.id,
            });

            this.overallFeedback = response.feedbacktext;
        }
    }

    /**
     * @inheritdoc
     */
    protected async logActivity(): Promise<void> {
        if (!this.tabletquiz) {
            return; // Shouldn't happen.
        }

        await CorePromiseUtils.ignoreErrors(AddonModTabletQuiz.logViewTabletQuiz(this.tabletquiz.id));

        this.analyticsLogEvent('mod_tabletquiz_view_tabletquiz');
    }

    /**
     * Go to review an attempt that has just been finished.
     */
    protected async goToAutoReview(attempts: AddonModTabletQuizAttemptWSData[]): Promise<void> {
        if (!this.autoReview) {
            return;
        }

        // If we go to auto review it means an attempt was finished. Check completion status.
        this.checkCompletion();

        // Verify that user can see the review.
        const attempt = attempts.find(attempt => attempt.id === this.autoReview?.attemptId);
        this.autoReview = undefined;

        if (!this.tabletquiz || !this.tabletquizAccessInfo || !attempt) {
            return;
        }

        const canReview = await AddonModTabletQuizHelper.canReviewAttempt(this.tabletquiz, this.tabletquizAccessInfo, attempt);
        if (!canReview) {
            return;
        }

        await this.reviewAttempt(attempt.id);
    }

    /**
     * @inheritdoc
     */
    protected hasSyncSucceed(result: AddonModTabletQuizSyncResult): boolean {
        if (result.attemptFinished) {
            // An attempt was finished, check completion status.
            this.checkCompletion();
        }

        // If the sync call isn't rejected it means the sync was successful.
        return result.updated;
    }

    /**
     * User entered the page that contains the component.
     */
    async ionViewDidEnter(): Promise<void> {
        super.ionViewDidEnter();

        if (!this.hasPlayed) {
            this.autoReview = undefined;

            return;
        }

        this.hasPlayed = false;

        // Refresh data.
        this.showLoading = true;
        this.content?.scrollToTop();

        await CorePromiseUtils.ignoreErrors(this.refreshContent(true));

        this.showLoading = false;
        this.autoReview = undefined;
    }

    /**
     * User left the page that contains the component.
     */
    ionViewDidLeave(): void {
        super.ionViewDidLeave();
        this.autoReview = undefined;
    }

    /**
     * Perform the invalidate content function.
     *
     * @returns Resolved when done.
     */
    protected async invalidateContent(): Promise<void> {
        const promises: Promise<void>[] = [];

        promises.push(AddonModTabletQuiz.invalidateTabletQuizData(this.courseId));

        if (this.tabletquiz) {
            promises.push(AddonModTabletQuiz.invalidateUserAttemptsForUser(this.tabletquiz.id));
            promises.push(AddonModTabletQuiz.invalidateTabletQuizAccessInformation(this.tabletquiz.id));
            promises.push(AddonModTabletQuiz.invalidateTabletQuizRequiredQtypes(this.tabletquiz.id));
            promises.push(AddonModTabletQuiz.invalidateAttemptAccessInformation(this.tabletquiz.id));
            promises.push(AddonModTabletQuiz.invalidateCombinedReviewOptionsForUser(this.tabletquiz.id));
            promises.push(AddonModTabletQuiz.invalidateUserBestGradeForUser(this.tabletquiz.id));
            promises.push(AddonModTabletQuiz.invalidateGradeFromGradebook(this.courseId));
        }

        await Promise.all(promises);
    }

    /**
     * Compares sync event data with current data to check if refresh content is needed.
     *
     * @param syncEventData Data receiven on sync observer.
     * @returns True if refresh is needed, false otherwise.
     */
    protected isRefreshSyncNeeded(syncEventData: AddonModTabletQuizAutoSyncData): boolean {
        if (!this.courseId || !this.module) {
            return false;
        }

        if (syncEventData.attemptFinished) {
            // An attempt was finished, check completion status.
            this.checkCompletion();
        }

        if (this.tabletquiz && syncEventData.tabletquizId == this.tabletquiz.id) {
            this.content?.scrollToTop();

            return true;
        }

        return false;
    }

    /**
     * Open a tabletquiz to attempt it.
     */
    protected async openTabletQuiz(): Promise<void> {
        this.hasPlayed = true;

        await CoreNavigator.navigateToSitePath(
            `${ADDON_MOD_TABLETQUIZ_PAGE_NAME}/${this.courseId}/${this.module.id}/player`,
            {
                params: {
                    moduleUrl: this.module.url,
                },
            },
        );
    }

    /**
     * Displays some data based on the current status.
     *
     * @param status The current status.
     * @param previousStatus The previous status. If not defined, there is no previous status.
     */
    protected showStatus(status: DownloadStatus, previousStatus?: DownloadStatus): void {
        this.showStatusSpinner = status === DownloadStatus.DOWNLOADING;

        if (status === DownloadStatus.DOWNLOADED && previousStatus === DownloadStatus.DOWNLOADING) {
            // TabletQuiz downloaded now, maybe a new attempt was created. Load content again.
            this.showLoadingAndFetch();
        }
    }

    /**
     * @inheritdoc
     */
    protected async sync(): Promise<AddonModTabletQuizSyncResult> {
        if (!this.candidateTabletQuiz) {
            return {
                warnings: [],
                attemptFinished: false,
                updated: false,
            };
        }

        return AddonModTabletQuizSync.syncTabletQuiz(this.candidateTabletQuiz, true);
    }

    /**
     * Treat user attempts.
     *
     * @param tabletquiz TabletQuiz data.
     * @param accessInfo TabletQuiz access information.
     * @param attempts The attempts to treat.
     * @returns Formatted attempts.
     */
    protected async treatAttempts(
        tabletquiz: AddonModTabletQuizTabletQuizData,
        accessInfo: AddonModTabletQuizGetTabletQuizAccessInformationWSResponse,
        attempts: AddonModTabletQuizAttemptWSData[],
    ): Promise<TabletQuizAttempt[]> {
        if (!attempts || !attempts.length) {
            // There are no attempts to treat.
            tabletquiz.gradeFormatted = AddonModTabletQuiz.formatGrade(tabletquiz.grade, tabletquiz.decimalpoints);

            return [];
        }

        const lastCompleted = AddonModTabletQuiz.getLastCompletedAttemptFromList(attempts);
        let openReview = false;

        if (this.autoReview && lastCompleted && lastCompleted.id >= this.autoReview.attemptId) {
            // User just finished an attempt in offline and it seems it's been synced, since it's finished in online.
            // Go to the review of this attempt if the user hasn't left this view.
            if (!this.isDestroyed && this.isCurrentView) {
                openReview = true;
            }
        }

        const [options] = await Promise.all([
            AddonModTabletQuiz.getCombinedReviewOptions(tabletquiz.id, { cmId: this.module.id }),
            this.getTabletQuizGrade(),
            openReview ? this.goToAutoReview(attempts) : undefined,
        ]);

        this.options = options;

        AddonModTabletQuizHelper.setTabletQuizCalculatedData(tabletquiz, this.options);

        this.overallStats = !!lastCompleted && this.options.alloptions.marks >= QuestionDisplayOptionsMarks.MARK_AND_MAX;

        // Calculate data to show for each attempt.
        const formattedAttempts = await Promise.all(attempts.map(async (attempt) => {
            const [formattedAttempt, canReview] = await Promise.all([
                AddonModTabletQuizHelper.setAttemptCalculatedData(tabletquiz, attempt) as Promise<TabletQuizAttempt>,
                AddonModTabletQuizHelper.canReviewAttempt(tabletquiz, accessInfo, attempt),
            ]);

            formattedAttempt.canReview = canReview;
            if (!canReview) {
                formattedAttempt.cannotReviewMessage = AddonModTabletQuizHelper.getCannotReviewMessage(tabletquiz, attempt, true);
            }

            if (tabletquiz.showFeedback && attempt.state === AddonModTabletQuizAttemptStates.FINISHED &&
                    options.someoptions.overallfeedback && isSafeNumber(formattedAttempt.rescaledGrade)) {

                // Feedback should be displayed, get the feedback for the grade.
                const response = await AddonModTabletQuiz.getFeedbackForGrade(tabletquiz.id, formattedAttempt.rescaledGrade, {
                    cmId: tabletquiz.coursemodule,
                });

                if (response.feedbacktext) {
                    formattedAttempt.additionalData = [
                        {
                            id: 'feedback',
                            title: Translate.instant('addon.mod_tabletquiz.feedback'),
                            content: response.feedbacktext,
                        },
                    ];
                }
            }

            return formattedAttempt;
        }));

        return formattedAttempts.reverse();
    }

    /**
     * Get tabletquiz grade data.
     */
    protected async getTabletQuizGrade(): Promise<void> {
        try {
            // Get gradebook grade.
            const data = await AddonModTabletQuiz.getGradeFromGradebook(this.courseId, this.module.id);

            if (data) {
                const grade = data.graderaw ?? (data.grade !== undefined && data.grade !== null ? Number(data.grade) : undefined);

                this.gradebookData = {
                    grade: safeNumber(grade),
                    feedback: data.feedback,
                };
            }
        } catch {
            // Fallback to tabletquiz best grade if failure or not found.
            this.gradebookData = {
                grade: this.bestGrade?.grade,
            };
        }
    }

    /**
     * Go to page to review the attempt.
     */
    async reviewAttempt(attemptId: number): Promise<void> {
        await CoreNavigator.navigateToSitePath(
            `${ADDON_MOD_TABLETQUIZ_PAGE_NAME}/${this.courseId}/${this.module.id}/review/${attemptId}`,
        );
    }

    /**
     * @inheritdoc
     */
    ngOnDestroy(): void {
        super.ngOnDestroy();

        this.finishedObserver?.off();
    }

}

type TabletQuizAttempt = AddonModTabletQuizAttempt & {
    canReview?: boolean;
    cannotReviewMessage?: string;
    additionalData?: AddonModTabletQuizWSAdditionalData[]; // Additional data to display for the attempt.
};
