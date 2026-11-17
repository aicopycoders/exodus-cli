export declare const UNIVERSAL_IDS: readonly ["brand", "product", "script", "people", "voice", "place", "hook", "song", "finish", "mode", "output", "method", "freeze", "later"];
export declare const SUBROW_IDS: readonly ["product.inUsePhotoUrl", "product.subject", "product.noPhotoPolicy", "script.path", "script.spoken", "script.level", "script.type", "script.length", "script.ad", "script.about", "script.audience", "script.offer", "script.mechanism", "script.structureKey", "script.referenceKey", "script.adaptation", "script.skeleton", "people.actor", "people.elements", "people.speakerCap", "people.staging", "people.ontology", "people.style", "people.wrapper", "place.terrain", "place.setup", "place.location", "finish.endCard", "finish.captions", "finish.cards", "finish.soundEffects", "finish.targetSeconds", "mode.pictures", "mode.audition", "output.sceneFrameCandidates", "output.model", "output.resolution", "output.aspect", "song.genre", "song.mood", "song.vocal", "song.instruments", "song.bpm", "song.durationSec", "song.source", "song.assetId", "song.rightsStatement", "song.trimStartSec", "song.trimEndSec", "song.pairs", "hook.line", "ugc.filming", "ugc.productAppearance", "ugc.hookDraftCount", "ugc.realismOn", "ugc.retentionPicks", "ugc.creativeBrief", "ugc.authoringMode", "ugc.hook", "ugc.angle", "ugc.pick", "ugc.personId", "ugc.referenceId", "ugc.matchedReferenceIds", "ugc.structure", "ugc.verbalHook", "ugc.visualHook", "skeleton.pronunciations", "skeleton.recurringCast", "skeleton.style", "skeleton.opener", "skeleton.matchedReferenceIds", "ugc.referenceIds", "skeleton.referenceId", "skeleton.referenceIds", "skeleton.structure", "skeleton.verbalHook", "skeleton.visualHook", "skeleton.referencePerson", "skeleton.referencePlace", "skeleton.referenceFilming", "personification.roleVoices", "personification.pronunciations", "personification.music", "personification.openingMenu", "personification.chosenOpening", "yapper.authorityName", "yapper.interviewerName", "yapper.interviewerDescription", "yapper.authorityVoice", "yapper.interviewerVoice", "yapper.approvedControls", "yapper.authoritySelection"];
export declare const VALUE_LIMITS: {
    readonly text: 32000;
    readonly list: 64;
    readonly map: 128;
    readonly rows: 128;
    readonly draftBytes: 96000;
};
export type SheetRow = {
    id: string;
    value: unknown;
    editable: boolean;
    locked?: boolean;
    status: string;
    editor?: {
        kind: string;
    };
};
export declare const NUMBER_ROWS: string[];
export declare const STRING_LIST_ROWS: string[];
export declare const BOOLEAN_ROWS: string[];
export declare const RAW_TEXT_ROWS: string[];
export declare function wireObject(value: unknown): Record<string, unknown>;
export declare function validRowValue(id: string, value: unknown): boolean;
