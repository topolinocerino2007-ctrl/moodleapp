// (C) Copyright 2015 Moodle Pty Ltd.
// ... (licenza)

import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CoreContentLinksHelper } from '@features/contentlinks/services/contentlinks-helper';
import { CoreSites } from '@services/sites'
import { CoreNavigator } from '@services/navigator';
import { AddonModTabletQuizAttempt, AddonModTabletQuizTabletQuizData } from '../../services/tabletquiz-helper';
import { AddonModTabletQuiz, AddonModTabletQuizWSAdditionalData } from '../../services/tabletquiz';
import { ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, AddonModTabletQuizAttemptStates } from '../../constants';
import { CoreTime } from '@singletons/time';
import { Translate } from '@singletons';
import { CoreDom } from '@singletons/dom';
import { isSafeNumber } from '@/core/utils/types';
import { AddonModTabletQuizAttemptStateComponent } from '../attempt-state/attempt-state';
import { CoreSharedModule } from '@/core/shared.module';

/**
 * Component that displays an attempt info.
 */
@Component({
    selector: 'addon-mod-tabletquiz-attempt-info',
    templateUrl: 'attempt-info.html',
    imports: [
        CoreSharedModule,
        AddonModTabletQuizAttemptStateComponent,
    ],
})
export class AddonModTabletQuizAttemptInfoComponent implements OnChanges {

    @Input({ required: true }) tabletquiz!: AddonModTabletQuizTabletQuizData;
    @Input({ required: true }) attempt!: AddonModTabletQuizAttempt;
    @Input() additionalData?: AddonModTabletQuizWSAdditionalData[]; 

    isFinished = false;
    readableMark = '';
    readableGrade = '';
    timeTaken?: string;
    overTime?: string;
    gradeItemMarks: { name: string; grade: string }[] = [];
    component = ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY;
/**
     * Navigazione verso la revisione del tentativo.
     */
    async reviewAttempt(): Promise<void> {
        const attemptId = this.attempt.id;
        const cmId = this.tabletquiz.coursemodule;
        const courseId = this.tabletquiz.course;

        // Percorso interno dell'app (Mobile Routing)
        const path = `tabletquiz/${courseId}/${cmId}/review/${attemptId}`;

        console.log("Forzo la revisione nativa su path:", path);

        try {
            // Tenta la navigazione fluida interna
            await CoreNavigator.navigate(path);
        } catch (error) {
            console.error("Navigazione interna fallita, uso fallback protetto:", error);
            
            // Fallback: Apre la pagina del sito ma restando dentro l'interfaccia dell'app
            const site = CoreSites.getRequiredCurrentSite();
            const url = `${site.getURL()}/mod/tabletquiz/review.php?attempt=${attemptId}`;
            
            // Questo metodo è più sicuro di openInInternalBrowser perché gestisce i permessi
            CoreContentLinksHelper.goInSite(site, url);
        }
    }

    /**
     * @inheritdoc
     */
    async ngOnChanges(changes: SimpleChanges): Promise<void> {
        if (changes.additionalData) {
            this.additionalData?.forEach((data) => {
                data.content = CoreDom.removeElementFromHtml(data.content, '.helptooltip');
            });
        }

        if (!changes.attempt) {
            return;
        }

        this.isFinished = this.attempt.state === AddonModTabletQuizAttemptStates.FINISHED;
        if (!this.isFinished) {
            return;
        }

        const timeTaken = (this.attempt.timefinish || 0) - (this.attempt.timestart || 0);
        if (timeTaken > 0) {
            this.timeTaken = CoreTime.formatTime(timeTaken);
            if (this.tabletquiz.timelimit && timeTaken > this.tabletquiz.timelimit + 60) {
                this.overTime = CoreTime.formatTime(timeTaken - this.tabletquiz.timelimit);
            }
        } else {
            this.timeTaken = undefined;
        }

        if (this.attempt.sumgrades === null || !this.attempt.gradeitemmarks) {
            this.gradeItemMarks = [];
        } else {
            this.gradeItemMarks = this.attempt.gradeitemmarks.map((gradeItemMark) => ({
                name: gradeItemMark.name,
                grade: Translate.instant('addon.mod_tabletquiz.outof', { $a: {
                    grade: `<strong>${AddonModTabletQuiz.formatGrade(gradeItemMark.grade, this.tabletquiz?.decimalpoints)}</strong>`,
                    maxgrade: AddonModTabletQuiz.formatGrade(gradeItemMark.maxgrade, this.tabletquiz?.decimalpoints),
                } }),
            }));
        }

        if (!this.tabletquiz.showAttemptsGrades) {
            return;
        }

        if (!isSafeNumber(this.attempt.rescaledGrade)) {
            this.readableGrade = Translate.instant('addon.mod_tabletquiz.notyetgraded');
            return;
        }

        if (this.tabletquiz.showAttemptsMarks) {
            this.readableMark = Translate.instant('addon.mod_tabletquiz.outofshort', { $a: {
                grade: AddonModTabletQuiz.formatGrade(this.attempt.sumgrades, this.tabletquiz.decimalpoints),
                maxgrade: AddonModTabletQuiz.formatGrade(this.tabletquiz.sumgrades, this.tabletquiz.decimalpoints),
            } });
        }

        const gradeObject: Record<string, unknown> = {
            grade: `<strong>${AddonModTabletQuiz.formatGrade(this.attempt.rescaledGrade, this.tabletquiz.decimalpoints)}</strong>`,
            maxgrade: AddonModTabletQuiz.formatGrade(this.tabletquiz.grade, this.tabletquiz.decimalpoints),
        };

        if (this.tabletquiz.grade != 100) {
            const percentage = (this.attempt.sumgrades ?? 0) * 100 / (this.tabletquiz.sumgrades ?? 1);
            gradeObject.percent = `<strong>${AddonModTabletQuiz.formatGrade(percentage, this.tabletquiz.decimalpoints)}</strong>`;
            this.readableGrade = Translate.instant('addon.mod_tabletquiz.outofpercent', { $a: gradeObject });
        } else {
            this.readableGrade = Translate.instant('addon.mod_tabletquiz.outof', { $a: gradeObject });
        }
    }
}




