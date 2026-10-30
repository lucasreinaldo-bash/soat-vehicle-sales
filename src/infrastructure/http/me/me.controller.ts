import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ListMyPurchasesUseCase } from '../../../application/use-cases/sale/list-my-purchases.usecase';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { MyPurchaseResponseDto } from './my-purchase-response.dto';

@ApiTags('Cliente')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly listMyPurchases: ListMyPurchasesUseCase) {}

  @Get('purchases')
  @Roles('customer')
  @ApiOperation({
    summary: 'Minhas compras',
    description:
      'Compras do cliente autenticado, da mais recente para a mais antiga. Não há parâmetro de ' +
      'cliente: o filtro vem do token, então ninguém consulta compras de outra pessoa.',
  })
  @ApiResponse({ status: 200, type: [MyPurchaseResponseDto] })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado' })
  @ApiResponse({ status: 403, description: 'Exige o papel customer' })
  async purchases(@CurrentUser() usuario: AuthenticatedUser): Promise<MyPurchaseResponseDto[]> {
    const compras = await this.listMyPurchases.execute(usuario.id);
    return compras.map((compra) => MyPurchaseResponseDto.fromDomain(compra));
  }
}
