import { Injectable } from '@angular/core';
import { CoreContentLinksHandlerBase } from '@features/contentlinks/classes/base-handler';
import { CoreContentLinksAction } from '@features/contentlinks/services/contentlinks-delegate';
import { makeSingleton } from '@singletons';
// import { AddonModTabletQuizHelper } from '../tabletquiz-helper'; <--- Possiamo bypassarlo se forziamo la rotta
import { ADDON_MOD_TABLETQUIZ_FEATURE_NAME, ADDON_MOD_TABLETQUIZ_PAGE_NAME } from '../../constants';
import { CoreNavigator } from '@services/navigator'; // <--- AGGIUNGI QUESTO

@Injectable({ providedIn: 'root' })
export class AddonModTabletQuizReviewLinkHandlerService extends CoreContentLinksHandlerBase {

    name = 'AddonModTabletQuizReviewLinkHandler';
    featureName = ADDON_MOD_TABLETQUIZ_FEATURE_NAME;
    pattern = /\/mod\/tabletquiz\/review\.php.*([&?]attempt=\d+)/;

    /**
     * Controlla se l'handler è abilitato.
     * AGGIUNGI QUESTO METODO: è il "permesso" che ti manca.
     */
    async isEnabled(siteId: string, url: string, params: Record<string, string>): Promise<boolean> {
        return true; // Forza il supporto alla revisione nell'app
    }

    getActions(
        siteIds: string[],
        url: string,
        params: Record<string, string>,
        courseId?: number,
        data?: Record<string, unknown>,
    ): CoreContentLinksAction[] | Promise<CoreContentLinksAction[]> {
        
        return [{
            action: async (siteId): Promise<void> => {
                const attemptId = parseInt(params.attempt, 10);
                const page = params.page !== undefined ? parseInt(params.page, 10) : 0;
                
                // RECUPERIAMO IL CMID (necessario per la rotta che abbiamo creato nel module.ts)
                const cmId = data?.cmId ? Number(data.cmId) : (params.cmid ? Number(params.cmid) : undefined);
                const courseIdNum = courseId || (params.courseid ? Number(params.courseid) : undefined);

                if (cmId && courseIdNum) {
                    // SE ABBIAMO I DATI, USIAMO LA TUA NUOVA ROTTA NATIVA
                    CoreNavigator.navigateToSitePath(
                        `${ADDON_MOD_TABLETQUIZ_PAGE_NAME}/${courseIdNum}/${cmId}/review/${attemptId}`,
                        { params: { page }, siteId }
                    );
                } else {
                    // FALLBACK: Se mancano i dati ID, proviamo a usare il vecchio helper o apriamo nel browser
                    // ma avendo forzato isEnabled sopra, il "not available" dovrebbe sparire.
                    const { AddonModTabletQuizHelper } = await import('../tabletquiz-helper');
                    await AddonModTabletQuizHelper.handleReviewLink(attemptId, page, undefined, siteId);
                }
            },
        }];
    }
}

export const AddonModTabletQuizReviewLinkHandler = makeSingleton(AddonModTabletQuizReviewLinkHandlerService);
