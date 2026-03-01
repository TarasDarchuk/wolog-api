import { IsString, IsOptional } from 'class-validator';

export class AppleAuthDto {
  @IsString()
  identityToken: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class GoogleAuthDto {
  @IsString()
  idToken: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}

export class LogoutDto {
  @IsString()
  refreshToken: string;
}

export class AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
  };
}
