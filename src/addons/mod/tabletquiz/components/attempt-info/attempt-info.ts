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

import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
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
async reviewAttempt(): Promise<void> {
    if (!this.attempt || !this.tabletquiz) {
        return;
    }

    // Usando ../../ torniamo indietro da ":courseId/:cmId" 
    // e entriamo in "review/:attemptId"
    CoreNavigator.navigate(`../../review/${this.attempt.id}`);
}
    @Input({ required: true }) tabletquiz!: AddonModTabletQuizTabletQuizData;
    @Input({ required: true }) attempt!: AddonModTabletQuizAttempt;
    @Input() additionalData?: AddonModTabletQuizWSAdditionalData[]; // Additional data to display for the attempt.

    isFinished = false;
    readableMark = '';
    readableGrade = '';
    timeTaken?: string;
    overTime?: string;
    gradeItemMarks: { name: string; grade: string }[] = [];
    component = ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY;

    /**
     * @inheritdoc
     */
    async ngOnChanges(changes: SimpleChanges): Promise<void> {
        if (changes.additionalData) {
            this.additionalData?.forEach((data) => {
                // Remove help links from additional data.
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
            // Format time taken.
            this.timeTaken = CoreTime.formatTime(timeTaken);

            // Calculate overdue time.
            if (this.tabletquiz.timelimit && timeTaken > this.tabletquiz.timelimit + 60) {
                this.overTime = CoreTime.formatTime(timeTaken - this.tabletquiz.timelimit);
            }
        } else {
            this.timeTaken = undefined;
        }

        // Treat grade item marks.
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

        // Treat grade and mark.
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




