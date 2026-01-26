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

import { Injectable, Type } from '@angular/core';
import { CoreCourseModuleHandler, CoreCourseModuleHandlerData } from '@features/course/services/module-delegate';
import { CoreCourseAnyModuleData } from '@features/course/services/course-helper';
import { makeSingleton } from '@singletons';
import { CoreModuleHandlerBase } from '@features/course/classes/module-base-handler';
import { ADDON_MOD_TABLETQUIZ_MODNAME, ADDON_MOD_TABLETQUIZ_PAGE_NAME } from '../../constants';
import { ModFeature, ModPurpose } from '@addons/mod/constants';

/**
 * Handler to support tabletquiz modules.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletQuizModuleHandlerService extends CoreModuleHandlerBase implements CoreCourseModuleHandler {

    name = 'AddonModTabletQuiz';
    modName = ADDON_MOD_TABLETQUIZ_MODNAME;
    protected pageName = ADDON_MOD_TABLETQUIZ_PAGE_NAME;

    supportedFeatures = {
        [ModFeature.GROUPS]: true,
        [ModFeature.GROUPINGS]: true,
        [ModFeature.MOD_INTRO]: true,
        [ModFeature.COMPLETION_TRACKS_VIEWS]: true,
        [ModFeature.COMPLETION_HAS_RULES]: true,
        [ModFeature.GRADE_HAS_GRADE]: true,
        [ModFeature.GRADE_OUTCOMES]: true,
        [ModFeature.BACKUP_MOODLE2]: true,
        [ModFeature.SHOW_DESCRIPTION]: true,
        [ModFeature.CONTROLS_GRADE_VISIBILITY]: true,
        [ModFeature.USES_QUESTIONS]: true,
        [ModFeature.PLAGIARISM]: true,
        [ModFeature.MOD_PURPOSE]: ModPurpose.ASSESSMENT,
    };

    /**
     * Verifica se il modulo è abilitato a livello globale.
     * Restituendo true, forziamo l'app a non mostrare "Content not available".
     */
    async isEnabled(): Promise<boolean> {
        return true;
    }

    /**
     * Verifica se il modulo è abilitato per un corso specifico.
     * Sovrascriviamo la base per evitare blocchi dai dati del server.
     */
    async isEnabledForCourse(
        courseId: number,
        module: CoreCourseAnyModuleData,
        forCoursePage?: boolean,
    ): Promise<boolean> {
        return true;
    }

    /**
     * @inheritdoc
     */
    async getMainComponent(): Promise<Type<unknown>> {
        const { AddonModTabletQuizIndexComponent } = await import('../../components/index');

        return AddonModTabletQuizIndexComponent;
    }

    /**
     * @inheritdoc
     */
    getDisplayData(module: CoreCourseAnyModuleData, courseId: number): CoreCourseModuleHandlerData {
        const data = super.getDisplayData(module, courseId);
        
        // Assicuriamoci che il titolo e l'icona siano quelli corretti
        return data;
    }

}

export const AddonModTabletQuizModuleHandler = makeSingleton(AddonModTabletQuizModuleHandlerService);
