export declare const VERIFIED_SIEBEL_JAR_SHA256: string;
export declare function sha256File(filename: string): Promise<string>;
export declare function inspectSiebelJar(filename: string, expectedHash?: string): Promise<{
  actualHash: string;
  expectedHash: string;
  compatible: boolean;
}>;
